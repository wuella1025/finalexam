const { createApp, ref, computed, onMounted, onUnmounted, watch } = Vue;

createApp({
    setup() {
        // --- 0. 核心設定 ---
        const TIMES = {
            FOCUS: 25 * 60,
            SHORT_BREAK: 5 * 60,
            LONG_BREAK: 15 * 60
        };

        const timeLeft = ref(TIMES.FOCUS);
        const isRunning = ref(false);
        const currentMode = ref('focus'); 
        
        // 用來記錄這一次專注「是幾點開始的」，用於圖表標籤
        // 這樣就算暫停，標籤也不會變，而且會一直是同一根長條
        const sessionStartTime = ref(null);

        // 讀取循環
        const savedCycle = localStorage.getItem('focus_cycle');
        const cycleCount = ref(savedCycle ? parseInt(savedCycle) : 1);

        // --- 1. 時鐘邏輯 ---
        const currentTime = ref('00:00:00');
        const currentDate = ref('YYYY-MM-DD');

        const updateClock = () => {
            const now = new Date();
            currentTime.value = now.toLocaleTimeString('zh-TW', { hour12: false });
            currentDate.value = now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
        };
        let clockInterval = null;

        // --- 2. 數據管理 ---
        const loadWeeklyHistory = () => {
            const h = localStorage.getItem('focus_history');
            return h ? JSON.parse(h) : {};
        };
        const weeklyHistory = ref(loadWeeklyHistory());

        const getTodayDateStr = () => {
            const d = new Date();
            return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
        };

        const loadDailySessions = () => {
            const s = localStorage.getItem('today_sessions');
            const lastDate = localStorage.getItem('last_record_date');
            const today = getTodayDateStr();

            // 只有「跨日」才清空
            if (lastDate !== today) {
                localStorage.setItem('last_record_date', today);
                return [];
            }
            return s ? JSON.parse(s) : [];
        };
        const dailySessions = ref(loadDailySessions());

        // 正式存檔（階段結束時呼叫）
        const recordFocusSession = (minutes) => {
            if (minutes <= 0) return;

            const today = getTodayDateStr();
            // 使用「開始時間」作為標籤，如果沒有（例如直接調試）則用現在時間
            const timeLabel = sessionStartTime.value || new Date().toTimeString().slice(0,5);

            // 更新週總量
            if (!weeklyHistory.value[today]) weeklyHistory.value[today] = 0;
            weeklyHistory.value[today] += minutes;
            localStorage.setItem('focus_history', JSON.stringify(weeklyHistory.value));

            // 更新今日詳情 (變成永久長條)
            dailySessions.value.push({ time: timeLabel, duration: minutes });
            localStorage.setItem('today_sessions', JSON.stringify(dailySessions.value));
            
            // 清除開始時間，準備下一次
            sessionStartTime.value = null;

            // 強制重繪
            updateCharts('default');
        };

        // --- 3. 日程安排 ---
        const newTaskInput = ref('');
        const loadTasks = () => {
            const t = localStorage.getItem('focus_tasks');
            return t ? JSON.parse(t) : [];
        };
        const tasks = ref(loadTasks());

        const saveTasks = () => {
            localStorage.setItem('focus_tasks', JSON.stringify(tasks.value));
        };

        const addTask = () => {
            if (newTaskInput.value.trim() === '') return;
            tasks.value.push({
                id: Date.now(),
                text: newTaskInput.value,
                done: false
            });
            newTaskInput.value = '';
            saveTasks();
        };

        const removeTask = (id) => {
            tasks.value = tasks.value.filter(t => t.id !== id);
            saveTasks();
        };

        // --- 4. 番茄鐘邏輯 ---
        const modeText = computed(() => {
            if (currentMode.value === 'focus') return '🔥 深度專注模式';
            if (currentMode.value === 'short-break') return '☕ 短暫休息';
            return '🌴 長時間休息';
        });

        const formatTime = computed(() => {
            const m = Math.floor(timeLeft.value / 60).toString().padStart(2, '0');
            const s = (timeLeft.value % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        });

        let timerInterval = null;

        const toggleTimer = () => {
            if (isRunning.value) {
                // 暫停：不清除 sessionStartTime，讓圖表保留
                clearInterval(timerInterval);
                isRunning.value = false;
                // 更新一下圖表確保暫停時長條還在
                updateCharts('none');
            } else {
                // 開始：如果是新的一輪（沒有開始時間），就記錄現在時間
                if (!sessionStartTime.value && currentMode.value === 'focus') {
                    const now = new Date();
                    sessionStartTime.value = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
                }

                isRunning.value = true;
                timerInterval = setInterval(() => {
                    if (timeLeft.value > 0) {
                        timeLeft.value--;
                        
                        // 專注模式下更新圖表
                        if (currentMode.value === 'focus') {
                            updateCharts('none');
                        }

                    } else {
                        handleTimerComplete();
                    }
                }, 1000);
            }
        };

        const handleTimerComplete = () => {
            clearInterval(timerInterval);
            isRunning.value = false;
            
            const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
            audio.play().catch(e => console.log('Autoplay prevented'));

            if (currentMode.value === 'focus') {
                // 紀錄完整的 25 分鐘
                recordFocusSession(25); 

                if (cycleCount.value < 4) {
                    currentMode.value = 'short-break';
                    timeLeft.value = TIMES.SHORT_BREAK;
                    alert('專注結束！休息 5 分鐘。');
                } else {
                    currentMode.value = 'long-break';
                    timeLeft.value = TIMES.LONG_BREAK;
                    alert('4 輪循環達成！休息 15 分鐘。');
                }
            } else {
                if (currentMode.value === 'long-break') cycleCount.value = 1;
                else cycleCount.value++;
                
                currentMode.value = 'focus';
                timeLeft.value = TIMES.FOCUS;
                // 切換回專注時，重置開始時間，確保下次產生新長條
                sessionStartTime.value = null;
                alert('休息結束，開始新的一輪！');
            }
        };

        const skipPhase = () => {
            clearInterval(timerInterval);
            isRunning.value = false;
            
            if (currentMode.value === 'focus') {
                // 跳過時，計算已經專注了多久，並存檔
                const elapsedSeconds = TIMES.FOCUS - timeLeft.value;
                const elapsedMinutes = parseFloat((elapsedSeconds / 60).toFixed(1));
                
                if (elapsedMinutes > 0) {
                    recordFocusSession(elapsedMinutes);
                } else {
                    sessionStartTime.value = null; // 沒專注就直接重置
                }

                currentMode.value = 'short-break';
                timeLeft.value = TIMES.SHORT_BREAK;
            } else {
                currentMode.value = 'focus';
                timeLeft.value = TIMES.FOCUS;
                sessionStartTime.value = null; // 新的專注開始
            }
            updateCharts();
        };

        watch(cycleCount, (newVal) => {
            localStorage.setItem('focus_cycle', newVal.toString());
        });

        // --- 5. Chart.js ---
        let weeklyChartInstance = null;
        let dailyChartInstance = null;
        
        const getLast7Days = () => {
            const days = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                days.push(`${d.getMonth()+1}/${d.getDate()}`);
            }
            return days;
        };

        const getWeeklyData = () => {
            const data = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const key = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
                data.push(weeklyHistory.value[key] || 0);
            }
            return data;
        };

        const initCharts = () => {
            const purple = '#bb86fc';
            const secondary = '#03dac6';
            const gridColor = '#333333';
            const textColor = '#a0a0a0';

            // 週表
            const ctx1 = document.getElementById('weeklyChart').getContext('2d');
            weeklyChartInstance = new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels: getLast7Days(),
                    datasets: [{
                        label: '總分鐘',
                        data: getWeeklyData(),
                        backgroundColor: purple,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor } },
                        x: { grid: { display: false }, ticks: { color: textColor } }
                    },
                    plugins: { legend: { display: false } }
                }
            });

            // 日表
            const ctx2 = document.getElementById('dailyChart').getContext('2d');
            dailyChartInstance = new Chart(ctx2, {
                type: 'bar',
                data: {
                    labels: dailySessions.value.map(s => s.time), 
                    datasets: [{
                        label: '專注時長',
                        data: dailySessions.value.map(s => s.duration),
                        backgroundColor: secondary,
                        borderRadius: 4,
                        barThickness: 20
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 0 },
                    scales: {
                        y: { 
                            beginAtZero: true,
                            grid: { color: gridColor }, 
                            ticks: { color: textColor, stepSize: 5 },
                            suggestedMax: 30
                        },
                        x: { grid: { display: false }, ticks: { color: textColor } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        };

        const updateCharts = (mode = 'default') => {
            if (weeklyChartInstance) {
                weeklyChartInstance.data.labels = getLast7Days();
                weeklyChartInstance.data.datasets[0].data = getWeeklyData();
                weeklyChartInstance.update(mode);
            }

            if (dailyChartInstance) {
                const labels = dailySessions.value.map(s => s.time);
                const data = dailySessions.value.map(s => s.duration);

                // [修正後的即時顯示邏輯]
                // 只要是專注模式，且不是「未開始」狀態（timeLeft < 25分），就顯示臨時長條
                // 這樣即使 isRunning 為 false (暫停)，長條依然會顯示
                if (currentMode.value === 'focus' && timeLeft.value < TIMES.FOCUS) {
                    const elapsedSeconds = TIMES.FOCUS - timeLeft.value;
                    const elapsedMinutes = parseFloat((elapsedSeconds / 60).toFixed(1));
                    
                    if (elapsedMinutes > 0) {
                        // 使用 sessionStartTime 作為標籤，確保它是固定的
                        const label = (sessionStartTime.value || '...') + ' (進行中)';
                        labels.push(label);
                        data.push(elapsedMinutes);
                    }
                }

                dailyChartInstance.data.labels = labels;
                dailyChartInstance.data.datasets[0].data = data;
                dailyChartInstance.update(mode);
            }
        };

        // --- 6. 基礎功能 ---
        const wsMessage = ref('連線中...');
        const latency = ref(0);
        const isWsConnected = ref(false);
        let ws = null;

        onMounted(() => {
            ws = new WebSocket('wss://echo.websocket.org');
            ws.onopen = () => {
                isWsConnected.value = true;
                wsMessage.value = '已連線';
                setInterval(() => { if(ws.readyState===1) ws.send(Date.now()) }, 2000);
            };
            ws.onmessage = (e) => {
                const t = parseInt(e.data);
                if(!isNaN(t)) latency.value = Date.now() - t;
            };
            
            updateClock();
            clockInterval = setInterval(updateClock, 1000);

            initCharts();
            setTimeout(() => updateCharts(), 100);
        });

        onUnmounted(() => {
            if(timerInterval) clearInterval(timerInterval);
            if(clockInterval) clearInterval(clockInterval);
            if(ws) ws.close();
        });

        return {
            timeLeft, formatTime, isRunning, currentMode, modeText, cycleCount,
            toggleTimer, skipPhase,
            tasks, newTaskInput, addTask, removeTask, saveTasks,
            wsMessage, latency, isWsConnected,
            currentTime, currentDate
        };
    }
}).mount('#app');
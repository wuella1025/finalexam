const { createApp, ref, computed, onMounted, onUnmounted, watch } = Vue;

createApp({
    setup() {
        // --- 0. 設定 ---
        const TIMES = { FOCUS: 25 * 60, SHORT_BREAK: 5 * 60, LONG_BREAK: 15 * 60 };
        const timeLeft = ref(TIMES.FOCUS);
        const isRunning = ref(false);
        const currentMode = ref('focus'); 
        const sessionStartTime = ref(null);
        let targetEndTime = null;

        const savedCycle = localStorage.getItem('focus_cycle');
        const cycleCount = ref(savedCycle ? parseInt(savedCycle) : 1);

        // --- 1. 時鐘 ---
        const currentTime = ref('00:00:00');
        const currentDate = ref('YYYY-MM-DD');
        const updateClock = () => {
            const now = new Date();
            currentTime.value = now.toLocaleTimeString('zh-TW', { hour12: false });
            currentDate.value = now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
        };
        let clockInterval = null;

        // --- 2. 數據 (持久化) ---
        const loadWeeklyHistory = () => {
            const h = localStorage.getItem('focus_history'); return h ? JSON.parse(h) : {};
        };
        const weeklyHistory = ref(loadWeeklyHistory());

        const getTodayDateStr = () => {
            const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
        };

        const loadDailySessions = () => {
            const s = localStorage.getItem('today_sessions');
            const lastDate = localStorage.getItem('last_record_date');
            const today = getTodayDateStr();
            if (lastDate !== today) {
                localStorage.setItem('last_record_date', today);
                return [];
            }
            return s ? JSON.parse(s) : [];
        };
        const dailySessions = ref(loadDailySessions());

        const recordFocusSession = (minutes) => {
            if (minutes <= 0) return;
            const today = getTodayDateStr();
            const timeLabel = sessionStartTime.value || new Date().toTimeString().slice(0,5);

            if (!weeklyHistory.value[today]) weeklyHistory.value[today] = 0;
            weeklyHistory.value[today] += minutes;
            localStorage.setItem('focus_history', JSON.stringify(weeklyHistory.value));

            dailySessions.value.push({ time: timeLabel, duration: minutes });
            localStorage.setItem('today_sessions', JSON.stringify(dailySessions.value));
            
            sessionStartTime.value = null;
            updateCharts('default');
        };

        const clearHistory = () => {
            if (confirm('確定要清除所有統計數據嗎？\n(這將刪除所有圖表紀錄)')) {
                localStorage.removeItem('focus_history');
                localStorage.removeItem('today_sessions');
                localStorage.removeItem('focus_cycle');
                
                weeklyHistory.value = {};
                dailySessions.value = [];
                cycleCount.value = 1;
                
                updateCharts('default');
            }
        };

        // --- 3. 任務 ---
        const newTaskInput = ref('');
        const loadTasks = () => { const t = localStorage.getItem('focus_tasks'); return t ? JSON.parse(t) : []; };
        const tasks = ref(loadTasks());
        const saveTasks = () => localStorage.setItem('focus_tasks', JSON.stringify(tasks.value));
        const addTask = () => {
            if (newTaskInput.value.trim() === '') return;
            tasks.value.push({ id: Date.now(), text: newTaskInput.value, done: false });
            newTaskInput.value = ''; saveTasks();
        };
        const removeTask = (id) => { tasks.value = tasks.value.filter(t => t.id !== id); saveTasks(); };

        // --- 4. 番茄鐘 ---
        const modeText = computed(() => {
            if (currentMode.value === 'focus') return '🔥 深度專注';
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
                clearInterval(timerInterval); 
                isRunning.value = false; 
                targetEndTime = null; 
                updateCharts('none');
            } else {
                if (!sessionStartTime.value && currentMode.value === 'focus') {
                    const now = new Date();
                    sessionStartTime.value = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
                }
                
                targetEndTime = Date.now() + (timeLeft.value * 1000);
                isRunning.value = true;

                if (currentMode.value === 'focus') {
                     updateCharts('none');
                }

                timerInterval = setInterval(() => {
                    const now = Date.now();
                    const remaining = Math.ceil((targetEndTime - now) / 1000);
                    if (remaining > 0) {
                        timeLeft.value = remaining;
                        if (currentMode.value === 'focus') updateCharts('none');
                    } else {
                        timeLeft.value = 0; handleTimerComplete();
                    }
                }, 1000);
            }
        };

        const handleTimerComplete = () => {
            clearInterval(timerInterval); isRunning.value = false; targetEndTime = null;
            
            // [修正] 更換為大聲的鬧鐘音效 (Mixkit 免費資源)
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.volume = 1.0; // 設定為最大聲
            audio.play().catch(e => console.log('Autoplay prevented', e));

            if (currentMode.value === 'focus') {
                recordFocusSession(25);
                if (cycleCount.value < 4) {
                    currentMode.value = 'short-break'; timeLeft.value = TIMES.SHORT_BREAK; alert('專注結束！休息 5 分鐘');
                } else {
                    currentMode.value = 'long-break'; timeLeft.value = TIMES.LONG_BREAK; alert('恭喜！休息 15 分鐘');
                }
            } else {
                if (currentMode.value === 'long-break') cycleCount.value = 1; else cycleCount.value++;
                currentMode.value = 'focus'; timeLeft.value = TIMES.FOCUS; sessionStartTime.value = null; alert('休息結束，開始新的一輪！');
            }
        };

        const skipPhase = () => {
            clearInterval(timerInterval); isRunning.value = false; targetEndTime = null;
            if (currentMode.value === 'focus') {
                const elapsedSeconds = TIMES.FOCUS - timeLeft.value;
                const elapsedMinutes = elapsedSeconds / 60;
                
                if (elapsedMinutes > 0) recordFocusSession(elapsedMinutes); 
                else sessionStartTime.value = null;
                
                currentMode.value = 'short-break'; timeLeft.value = TIMES.SHORT_BREAK;
            } else {
                currentMode.value = 'focus'; timeLeft.value = TIMES.FOCUS; sessionStartTime.value = null;
            }
            updateCharts();
        };

        watch(cycleCount, (n) => localStorage.setItem('focus_cycle', n.toString()));

        // --- 5. Charts ---
        let weeklyChartInstance = null;
        let dailyChartInstance = null;
        
        const getLast7Days = () => {
            const days = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date(); d.setDate(d.getDate() - i);
                days.push(`${d.getMonth()+1}/${d.getDate()}`);
            }
            return days;
        };
        const getWeeklyData = () => {
            const data = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date(); d.setDate(d.getDate() - i);
                const key = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
                data.push(weeklyHistory.value[key] || 0);
            }
            return data;
        };

        const initCharts = () => {
            const purple = '#bb86fc'; const secondary = '#03dac6'; const gridColor = '#333'; const textColor = '#a0a0a0';
            
            const ctx1 = document.getElementById('weeklyChart').getContext('2d');
            weeklyChartInstance = new Chart(ctx1, {
                type: 'bar',
                data: { labels: getLast7Days(), datasets: [{ label: '總分鐘', data: getWeeklyData(), backgroundColor: purple, borderRadius: 4 }] },
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor } }, x: { grid: { display: false }, ticks: { color: textColor } } }, plugins: { legend: { display: false } } }
            });

            const ctx2 = document.getElementById('dailyChart').getContext('2d');
            dailyChartInstance = new Chart(ctx2, {
                type: 'bar',
                data: { labels: dailySessions.value.map(s => s.time), datasets: [{ label: '專注時長', data: dailySessions.value.map(s => s.duration), backgroundColor: secondary, borderRadius: 4, barThickness: 20 }] },
                options: { responsive: true, maintainAspectRatio: false, animation: { duration: 0 }, scales: { y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, stepSize: 5 }, suggestedMax: 30 }, x: { grid: { display: false }, ticks: { color: textColor } } }, plugins: { legend: { display: false } } }
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
                if (isRunning.value && currentMode.value === 'focus') {
                    const elapsedSeconds = TIMES.FOCUS - timeLeft.value;
                    const elapsedMinutes = elapsedSeconds / 60; 
                    if (elapsedMinutes > 0) {
                        labels.push((sessionStartTime.value || '...') + ' (進行中)');
                        data.push(elapsedMinutes);
                    }
                }
                dailyChartInstance.data.labels = labels;
                dailyChartInstance.data.datasets[0].data = data;
                dailyChartInstance.update(mode);
            }
        };

        // --- 6. WS & Init ---
        const wsMessage = ref('連線中...'); const latency = ref(0); const isWsConnected = ref(false); let ws = null;

        onMounted(() => {
            ws = new WebSocket('wss://echo.websocket.org');
            ws.onopen = () => { isWsConnected.value = true; wsMessage.value = '已連線'; setInterval(() => { if(ws.readyState===1) ws.send(Date.now()) }, 2000); };
            ws.onmessage = (e) => { const t = parseInt(e.data); if(!isNaN(t)) latency.value = Date.now() - t; };
            
            updateClock(); clockInterval = setInterval(updateClock, 1000);
            initCharts(); setTimeout(() => updateCharts(), 100);
        });

        onUnmounted(() => { if(timerInterval) clearInterval(timerInterval); if(clockInterval) clearInterval(clockInterval); if(ws) ws.close(); });

        return {
            timeLeft, formatTime, isRunning, currentMode, modeText, cycleCount, toggleTimer, skipPhase,
            tasks, newTaskInput, addTask, removeTask, saveTasks,
            wsMessage, latency, isWsConnected, currentTime, currentDate,
            clearHistory
        };
    }
}).mount('#app');
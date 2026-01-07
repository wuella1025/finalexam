const { createApp, ref, computed, onMounted, onUnmounted, watch } = Vue;

// --- 模組 1: 時鐘邏輯 ---
function useClock() {
    const currentTime = ref('00:00:00');
    const currentDate = ref('YYYY/MM/DD');
    let intervalId = null;

    const updateClock = () => {
        const now = new Date();
        currentTime.value = now.toLocaleTimeString('zh-TW', { hour12: false });
        currentDate.value = now.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    onMounted(() => {
        updateClock();
        intervalId = setInterval(updateClock, 1000);
    });

    onUnmounted(() => {
        if (intervalId) clearInterval(intervalId);
    });

    return { currentTime, currentDate };
}

// --- 模組 2: 資料持久化 (歷史紀錄) ---
function useDataPersistence() {
    const getTodayDateStr = () => {
        const d = new Date();
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    };

    // 讀取紀錄 (改為同步讀取，避免閃爍)
    const loadWeeklyHistory = () => {
        try { return JSON.parse(localStorage.getItem('focus_history') || '{}'); } catch (e) { return {}; }
    };
    const weeklyHistory = ref(loadWeeklyHistory());

    const loadDailySessions = () => {
        try {
            const s = localStorage.getItem('today_sessions');
            const lastDate = localStorage.getItem('last_record_date');
            const today = getTodayDateStr();
            if (lastDate !== today) {
                localStorage.setItem('last_record_date', today);
                return [];
            }
            return s ? JSON.parse(s) : [];
        } catch (e) { return []; }
    };
    const dailySessions = ref(loadDailySessions());

    const saveRecord = (minutes, sessionStartTimeStr) => {
        if (minutes <= 0.1) return;
        const today = getTodayDateStr();
        const timeLabel = sessionStartTimeStr || new Date().toTimeString().slice(0, 5);

        if (!weeklyHistory.value[today]) weeklyHistory.value[today] = 0;
        weeklyHistory.value[today] += minutes;
        localStorage.setItem('focus_history', JSON.stringify(weeklyHistory.value));

        dailySessions.value.push({ time: timeLabel, duration: parseFloat(minutes.toFixed(1)) });
        localStorage.setItem('today_sessions', JSON.stringify(dailySessions.value));
        localStorage.setItem('last_record_date', today);
    };

    const clearAllData = () => {
        if (confirm('確定要清除所有統計數據嗎？\n(這將刪除所有圖表紀錄與任務)')) {
            localStorage.clear();
            location.reload();
        }
    };

    return { weeklyHistory, dailySessions, saveRecord, clearAllData };
}

// --- 模組 3: 任務管理 (修正：同步載入防止資料遺失) ---
function useTasks() {
    const newTaskInput = ref('');
    
    // 修正：直接在初始化時讀取，確保重整後馬上看到
    const loadTasks = () => {
        try { return JSON.parse(localStorage.getItem('focus_tasks') || '[]'); } 
        catch (e) { return []; }
    };
    const tasks = ref(loadTasks());

    const saveTasks = () => localStorage.setItem('focus_tasks', JSON.stringify(tasks.value));

    const addTask = () => {
        if (!newTaskInput.value.trim()) return;
        tasks.value.push({ id: Date.now(), text: newTaskInput.value, done: false });
        newTaskInput.value = '';
        saveTasks();
    };

    const toggleTask = (id) => {
        const task = tasks.value.find(t => t.id === id);
        if (task) {
            task.done = !task.done;
            saveTasks();
        }
    };

    const removeTask = (id) => {
        tasks.value = tasks.value.filter(t => t.id !== id);
        saveTasks();
    };

    return { tasks, newTaskInput, addTask, toggleTask, removeTask };
}

// --- 模組 4: 番茄鐘計時器 (修正：狀態持久化) ---
function useTimer(onComplete) {
    const TIMES = { FOCUS: 25 * 60, SHORT_BREAK: 5 * 60, LONG_BREAK: 15 * 60 };
    
    // 從 localStorage 讀取上次狀態，如果沒有則用預設值
    const getSavedState = (key, defaultVal) => {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : defaultVal;
    };

    const timeLeft = ref(getSavedState('timer_timeLeft', TIMES.FOCUS));
    const isRunning = ref(false); // 預設先暫停，稍後在 onMounted 檢查是否要自動繼續
    const currentMode = ref(localStorage.getItem('timer_mode') || 'focus');
    const sessionStartTime = ref(localStorage.getItem('timer_startTime') || null);
    const cycleCount = ref(parseInt(localStorage.getItem('focus_cycle') || '1'));

    let timerInterval = null;
    let targetEndTime = null;

    // 儲存計時器狀態到 localStorage
    const saveTimerState = () => {
        localStorage.setItem('timer_timeLeft', timeLeft.value);
        localStorage.setItem('timer_mode', currentMode.value);
        localStorage.setItem('focus_cycle', cycleCount.value);
        if (sessionStartTime.value) localStorage.setItem('timer_startTime', sessionStartTime.value);
        else localStorage.removeItem('timer_startTime');
        
        // 如果正在跑，還要存目標時間，這樣回來時可以算出過了多久
        if (isRunning.value && targetEndTime) {
            localStorage.setItem('timer_targetEndTime', targetEndTime);
            localStorage.setItem('timer_isRunning', 'true');
        } else {
            localStorage.removeItem('timer_targetEndTime');
            localStorage.setItem('timer_isRunning', 'false');
        }
    };

    const formatTime = computed(() => {
        const m = Math.floor(timeLeft.value / 60).toString().padStart(2, '0');
        const s = (timeLeft.value % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    });

    const modeText = computed(() => {
        if (currentMode.value === 'focus') return '深度專注';
        if (currentMode.value === 'short-break') return '短暫休息';
        return '長時間休息';
    });

    const modeColor = computed(() => currentMode.value === 'focus' ? '#bb86fc' : '#03dac6');

    const startTimer = (resume = false) => {
        if (!sessionStartTime.value && currentMode.value === 'focus') {
            const now = new Date();
            sessionStartTime.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        }
        
        // 如果是恢復執行 (Resume)，使用上次存的目標時間；否則建立新的目標時間
        if (!resume || !targetEndTime) {
             targetEndTime = Date.now() + (timeLeft.value * 1000);
        }

        isRunning.value = true;
        saveTimerState(); // 儲存狀態

        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            const now = Date.now();
            const remaining = Math.ceil((targetEndTime - now) / 1000);
            
            if (remaining > 0) {
                timeLeft.value = remaining;
                // 每秒稍微存一下，防止當機，但主要靠 start/pause 存
                if (remaining % 5 === 0) saveTimerState(); 
            } else {
                timeLeft.value = 0;
                handleComplete();
            }
        }, 1000);
    };

    const pauseTimer = () => {
        clearInterval(timerInterval);
        isRunning.value = false;
        targetEndTime = null;
        saveTimerState(); // 儲存暫停狀態
    };

    const toggleTimer = () => isRunning.value ? pauseTimer() : startTimer();

    const handleComplete = () => {
        pauseTimer();
        // 清除狀態
        localStorage.removeItem('timer_targetEndTime');
        localStorage.removeItem('timer_isRunning');

        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.volume = 1.0; audio.play().catch(() => {});

        if (currentMode.value === 'focus') {
            onComplete(TIMES.FOCUS / 60, sessionStartTime.value);
            
            if (cycleCount.value < 4) {
                currentMode.value = 'short-break'; timeLeft.value = TIMES.SHORT_BREAK;
            } else {
                currentMode.value = 'long-break'; timeLeft.value = TIMES.LONG_BREAK;
            }
            alert('專注結束！休息一下。');
        } else {
            cycleCount.value = (currentMode.value === 'long-break') ? 1 : cycleCount.value + 1;
            currentMode.value = 'focus';
            timeLeft.value = TIMES.FOCUS;
            sessionStartTime.value = null;
            alert('休息結束，開始新的一輪！');
        }
        saveTimerState(); // 存下新模式
    };

    const skipPhase = () => {
        pauseTimer();
        if (currentMode.value === 'focus') {
            const elapsed = (TIMES.FOCUS - timeLeft.value) / 60;
            onComplete(elapsed, sessionStartTime.value);
            currentMode.value = 'short-break'; timeLeft.value = TIMES.SHORT_BREAK;
        } else {
            currentMode.value = 'focus'; timeLeft.value = TIMES.FOCUS; sessionStartTime.value = null;
        }
        saveTimerState();
    };

    // --- 關鍵修復：網頁載入時恢復狀態 ---
    onMounted(() => {
        const savedIsRunning = localStorage.getItem('timer_isRunning') === 'true';
        const savedTargetEnd = localStorage.getItem('timer_targetEndTime');

        if (savedIsRunning && savedTargetEnd) {
            const now = Date.now();
            const remaining = Math.ceil((parseInt(savedTargetEnd) - now) / 1000);
            
            if (remaining > 0) {
                // 還有時間，繼續跑
                timeLeft.value = remaining;
                targetEndTime = parseInt(savedTargetEnd);
                startTimer(true); // true 代表是恢復執行
            } else {
                // 關閉期間時間已經到了
                timeLeft.value = 0;
                handleComplete();
            }
        }
    });

    onUnmounted(() => {
        if (timerInterval) clearInterval(timerInterval);
    });

    return { 
        timeLeft, formatTime, isRunning, currentMode, modeText, modeColor, cycleCount, 
        toggleTimer, skipPhase, pauseTimer, TIMES 
    };
}

// --- 模組 5: Chart.js 圖表 ---
function useCharts(weeklyHistory) {
    let weeklyChart = null;

    const getLast7Days = () => {
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            days.push(`${d.getMonth() + 1}/${d.getDate()}`);
        }
        return days;
    };

    const getWeeklyData = () => {
        const data = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
            data.push(weeklyHistory.value[key] || 0);
        }
        return data;
    };

    const renderCharts = () => {
        if (weeklyChart) { weeklyChart.destroy(); }
        const ctx1 = document.getElementById('weeklyChart');
        if (!ctx1) return;

        weeklyChart = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: getLast7Days(),
                datasets: [{
                    label: '分鐘',
                    data: getWeeklyData(),
                    backgroundColor: '#bb86fc',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#888', stepSize: 60, callback: (v) => (v / 60) + 'h' }
                    },
                    x: { grid: { display: false }, ticks: { color: '#888' } }
                },
                plugins: { legend: { display: false } }
            }
        });
    };

    return { renderCharts };
}

// --- 模組 6: WebSocket 網路監控 ---
function useNetworkMonitor() {
    const wsMessage = ref('連線初始化...');
    const latency = ref(0);
    const isWsConnected = ref(false);
    let ws = null;
    let pingInterval = null;

    const initWebSocket = () => {
        try {
            ws = new WebSocket('wss://echo.websocket.org');
            ws.onopen = () => {
                isWsConnected.value = true;
                wsMessage.value = '已連線';
                pingInterval = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) ws.send(Date.now());
                }, 5000);
            };
            ws.onmessage = (e) => {
                const t = parseInt(e.data);
                if (!isNaN(t)) latency.value = Date.now() - t;
            };
            ws.onclose = () => {
                isWsConnected.value = false;
                wsMessage.value = '已離線';
                setTimeout(initWebSocket, 5000);
            };
            ws.onerror = () => {
                isWsConnected.value = false;
                wsMessage.value = '連線錯誤';
                if(ws) ws.close();
            };
        } catch (e) {
            isWsConnected.value = false;
            setTimeout(initWebSocket, 5000);
        }
    };

    onMounted(() => initWebSocket());
    onUnmounted(() => {
        if (pingInterval) clearInterval(pingInterval);
        if (ws) ws.close();
    });

    return { wsMessage, latency, isWsConnected };
}

// --- 主應用組裝 ---
createApp({
    setup() {
        const { currentTime, currentDate } = useClock();
        const { weeklyHistory, dailySessions, saveRecord, clearAllData } = useDataPersistence();
        const { tasks, newTaskInput, addTask, toggleTask, removeTask } = useTasks();
        const { renderCharts } = useCharts(weeklyHistory);

        const onTimerComplete = (minutes, startTime) => {
            saveRecord(minutes, startTime);
            renderCharts();
        };

        const { 
            timeLeft, formatTime, isRunning, currentMode, modeText, 
            modeColor, cycleCount, toggleTimer, skipPhase, TIMES 
        } = useTimer(onTimerComplete);

        const { wsMessage, latency, isWsConnected } = useNetworkMonitor();

        const todayTotalMinutes = computed(() => {
            let total = dailySessions.value.reduce((sum, s) => sum + s.duration, 0);
            if (isRunning.value && currentMode.value === 'focus') {
                const elapsedSeconds = TIMES.FOCUS - timeLeft.value;
                const elapsedMinutes = elapsedSeconds / 60;
                total += elapsedMinutes;
            }
            return total;
        });
        const displayTotalMinutes = computed(() => Math.floor(todayTotalMinutes.value));

        onMounted(() => {
            setTimeout(renderCharts, 300);
        });

        return {
            currentTime, currentDate,
            clearHistory: clearAllData, todayTotalMinutes, displayTotalMinutes,
            tasks, newTaskInput, addTask, toggleTask, removeTask,
            timeLeft, formatTime, isRunning, currentMode, modeText, modeColor, cycleCount, toggleTimer, skipPhase,
            wsMessage, latency, isWsConnected
        };
    }
}).mount('#app');
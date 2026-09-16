// ==============================================
// ===== АВТОРИЗАЦИЯ =====
// ==============================================

function showLogin() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
}

function showRegister() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

function getUsers() {
    return JSON.parse(localStorage.getItem('users') || '[]');
}

function saveUsers(users) {
    localStorage.setItem('users', JSON.stringify(users));
}

// ===== ВАЛИДАЦИЯ EMAIL =====
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ===== РЕГИСТРАЦИЯ =====
function handleRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value.trim();

    // 1. Проверка на пустые поля
    if (!username) {
        alert('❌ Логин не может быть пустым.');
        return;
    }
    if (!email) {
        alert('❌ Почта не может быть пустой.');
        return;
    }
    if (!password) {
        alert('❌ Пароль не может быть пустым.');
        return;
    }

    // 2. Проверка длины логина
    if (username.length < 3) {
        alert('❌ Логин должен содержать минимум 3 символа.');
        return;
    }

    // 3. Проверка формата email
    if (!isValidEmail(email)) {
        alert('❌ Неверный формат почты. Пример: user@mail.com');
        return;
    }

    // 4. Проверка длины пароля
    if (password.length < 6) {
        alert('❌ Пароль должен содержать минимум 6 символов.');
        return;
    }

    const users = getUsers();

    // 5. Проверка на существующий email
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
        alert(`❌ Пользователь с почтой "${email}" уже зарегистрирован.`);
        return;
    }

    // 6. Проверка на существующий логин (регистронезависимо)
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
        alert(`❌ Логин "${username}" уже занят.`);
        return;
    }

    // ✅ Все проверки пройдены — регистрируем
    users.push({
        id: Date.now().toString(36),
        username: username,
        email: email,
        password: password,
        createdAt: new Date().toISOString()
    });
    saveUsers(users);

    alert('✅ Регистрация успешна! Теперь войдите.');
    showLogin();
    document.getElementById('regUsername').value = '';
    document.getElementById('regEmail').value = '';
    document.getElementById('regPassword').value = '';
}

// ===== ВХОД =====
function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();

    if (!email) {
        alert('❌ Введите почту.');
        return;
    }
    if (!password) {
        alert('❌ Введите пароль.');
        return;
    }

    const users = getUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

    if (!user) {
        alert(`❌ Пользователь с почтой "${email}" не найден. Проверьте почту или зарегистрируйтесь.`);
        return;
    }

    if (user.password !== password) {
        alert('❌ Неверный пароль. Проверьте регистр и раскладку клавиатуры.');
        return;
    }

    // ✅ Вход выполнен
    localStorage.setItem('session', JSON.stringify({
        userId: user.id,
        username: user.username,
        email: user.email,
        loggedInAt: new Date().toISOString()
    }));

    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    initApp();
}

// ===== ВЫХОД =====
function handleLogout() {
    localStorage.removeItem('session');
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('authPage').style.display = 'flex';
    switchTab('chat');
}

// ===== ПРОВЕРКА СЕССИИ =====
function checkSession() {
    const session = JSON.parse(localStorage.getItem('session') || 'null');
    if (session) {
        const users = getUsers();
        const userExists = users.some(u => u.id === session.userId);
        if (userExists) {
            initApp();
            return;
        } else {
            localStorage.removeItem('session');
        }
    }
    document.getElementById('authPage').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
}

// ===== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ =====
function initApp() {
    const session = JSON.parse(localStorage.getItem('session'));
    if (!session) return;

    document.getElementById('authPage').style.display = 'none';
    document.getElementById('mainApp').style.display = 'flex';

    document.getElementById('profileUsername').textContent = session.username;
    document.getElementById('profileEmail').textContent = session.email;
    document.getElementById('profileActiveSince').textContent = session.loggedInAt ? new Date(session.loggedInAt).toLocaleDateString() : '—';

    const storageKey = `appData_${session.userId}`;
    let data = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!data) {
        data = {
            chats: [{ id: 'chat1', name: 'Чат 1', messages: [] }],
            currentChatId: 'chat1',
            projects: [
                { id: 'proj1', name: 'Проект 1', files: [] },
                { id: 'proj2', name: 'Проект 2', files: [] }
            ],
            currentProjectId: 'proj1'
        };
        localStorage.setItem(storageKey, JSON.stringify(data));
    }
    window._state = data;
    window._storageKey = storageKey;

    renderChatList();
    renderMessages();
    renderProjectList();
    switchTab('chat');
}

// ==============================================
// ===== СОСТОЯНИЕ =====
// ==============================================

function saveState() {
    if (window._state && window._storageKey) {
        localStorage.setItem(window._storageKey, JSON.stringify(window._state));
    }
}

function getState() {
    return window._state;
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==============================================
// ===== ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК =====
// ==============================================

function switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tabMap = {
        chat: 'tabChat',
        projects: 'tabProjects',
        profile: 'tabProfile'
    };
    const target = document.getElementById(tabMap[tabId]);
    if (target) target.classList.add('active');

    document.querySelectorAll('header button:not(#btnLogout)').forEach(b => b.classList.remove('active'));
    const btnMap = {
        chat: 'btnChat',
        projects: 'btnProjects',
        profile: 'btnProfile'
    };
    const btn = document.getElementById(btnMap[tabId]);
    if (btn) btn.classList.add('active');

    if (tabId === 'chat') {
        renderChatList();
        renderMessages();
    }
    if (tabId === 'projects') {
        renderProjectList();
    }
    if (tabId === 'profile') {
        const session = JSON.parse(localStorage.getItem('session'));
        if (session) {
            document.getElementById('profileUsername').textContent = session.username;
            document.getElementById('profileEmail').textContent = session.email;
            document.getElementById('profileActiveSince').textContent = session.loggedInAt ? new Date(session.loggedInAt).toLocaleDateString() : '—';
        }
    }
}

// ==============================================
// ===== ЧАТЫ =====
// ==============================================

function renderChatList() {
    const state = getState();
    if (!state) return;
    const container = document.getElementById('chatList');
    container.innerHTML = '';
    state.chats.forEach(chat => {
        const div = document.createElement('div');
        div.className = 'chat-item' + (chat.id === state.currentChatId ? ' active' : '');
        div.textContent = chat.name;
        div.onclick = () => switchChat(chat.id);
        container.appendChild(div);
    });
}

function switchChat(chatId) {
    const state = getState();
    if (!state) return;
    state.currentChatId = chatId;
    saveState();
    renderChatList();
    renderMessages();
}

function createNewChat() {
    const state = getState();
    if (!state) return;
    const count = state.chats.length + 1;
    const newChat = { id: generateId(), name: `Чат ${count}`, messages: [] };
    state.chats.push(newChat);
    state.currentChatId = newChat.id;
    saveState();
    renderChatList();
    renderMessages();
}

function renderMessages() {
    const state = getState();
    if (!state) return;
    const chat = state.chats.find(c => c.id === state.currentChatId);
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    if (!chat) {
        container.innerHTML = '<div class="message bot"><span class="avatar">🤖</span><p>Выберите чат</p></div>';
        return;
    }
    if (chat.messages.length === 0) {
        container.innerHTML = '<div class="message bot"><span class="avatar">🤖</span><p>Загрузите код или задайте вопрос.</p></div>';
    } else {
        chat.messages.forEach(msg => {
            const div = document.createElement('div');
            div.className = 'message ' + (msg.sender === 'user' ? 'user' : 'bot');
            const avatar = msg.sender === 'user' ? '🧑' : '🤖';
            div.innerHTML = `<span class="avatar">${avatar}</span><p>${escapeHtml(msg.text)}</p>`;
            container.appendChild(div);
        });
    }
    container.scrollTop = container.scrollHeight;
}

// ===== ОТПРАВКА СООБЩЕНИЯ =====
document.addEventListener('DOMContentLoaded', function() {
    const sendBtn = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    const fileInput = document.getElementById('fileInput');

    if (sendBtn) {
        sendBtn.addEventListener('click', function() {
            const text = messageInput.value.trim();
            if (!text) return;

            const state = getState();
            if (!state) return;
            const chat = state.chats.find(c => c.id === state.currentChatId);
            if (!chat) return;

            chat.messages.push({ sender: 'user', text });
            saveState();
            renderMessages();
            messageInput.value = '';
            setTimeout(() => {
                chat.messages.push({ sender: 'bot', text: 'Ответ нейросети' });
                saveState();
                renderMessages();
            }, 800);
        });
    }

    if (messageInput) {
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (sendBtn) sendBtn.click();
            }
        });
    }

    // ===== ЗАГРУЗКА ФАЙЛА В ЧАТ =====
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            const files = e.target.files;
            if (!files.length) return;
            const state = getState();
            if (!state) return;
            const chat = state.chats.find(c => c.id === state.currentChatId);
            if (!chat) return;

            const names = Array.from(files).map(f => f.name).join(', ');
            chat.messages.push({ sender: 'user', text: `📎 ${names}` });
            saveState();
            renderMessages();
            e.target.value = '';
        });
    }
});

// ==============================================
// ===== ПРОЕКТЫ =====
// ==============================================

function renderProjectList() {
    const state = getState();
    if (!state) return;
    const container = document.getElementById('projectList');
    container.innerHTML = '';
    state.projects.forEach(proj => {
        const div = document.createElement('div');
        div.className = 'project-item' + (proj.id === state.currentProjectId ? ' active' : '');
        div.textContent = proj.name;
        div.onclick = () => switchProject(proj.id);
        container.appendChild(div);
    });
    renderProjectFiles();
}

function switchProject(projectId) {
    const state = getState();
    if (!state) return;
    state.currentProjectId = projectId;
    saveState();
    renderProjectList();
}

function createNewProject() {
    const state = getState();
    if (!state) return;
    const count = state.projects.length + 1;
    const newProj = { id: generateId(), name: `Проект ${count}`, files: [] };
    state.projects.push(newProj);
    state.currentProjectId = newProj.id;
    saveState();
    renderProjectList();
}

function renderProjectFiles() {
    const state = getState();
    if (!state) return;
    const proj = state.projects.find(p => p.id === state.currentProjectId);
    const container = document.getElementById('projectFilesList');
    const nameSpan = document.getElementById('currentProjectName');

    if (!proj) {
        nameSpan.textContent = 'Выберите проект';
        container.innerHTML = '';
        return;
    }

    nameSpan.textContent = proj.name;

    if (proj.files.length === 0) {
        container.innerHTML = '<div style="color:#aaa; font-size:13px; padding:20px 0;">Нет файлов</div>';
        return;
    }

    container.innerHTML = '';
    proj.files.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.innerHTML = `
            <span>${escapeHtml(file)}</span>
            <span class="file-delete" onclick="deleteFile(${index})">✕</span>
        `;
        container.appendChild(div);
    });
}

document.addEventListener('DOMContentLoaded', function() {
    const projectFileInput = document.getElementById('projectFileInput');
    if (projectFileInput) {
        projectFileInput.addEventListener('change', function(e) {
            const files = e.target.files;
            if (!files.length) return;
            const state = getState();
            if (!state) return;
            const proj = state.projects.find(p => p.id === state.currentProjectId);
            if (!proj) return;

            Array.from(files).forEach(f => proj.files.push(f.name));
            saveState();
            renderProjectFiles();
            e.target.value = '';
        });
    }
});

function deleteFile(index) {
    const state = getState();
    if (!state) return;
    const proj = state.projects.find(p => p.id === state.currentProjectId);
    if (!proj) return;
    proj.files.splice(index, 1);
    saveState();
    renderProjectFiles();
}

// ==============================================
// ===== ИНИЦИАЛИЗАЦИЯ =====
// ==============================================

checkSession();

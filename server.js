const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
const mongoose = require('mongoose');
const crypto = require('crypto'); // ВСТРОЕННЫЙ МОДУЛЬ, УСТАНАВЛИВАТЬ НЕ НАДО!

app.use(express.static(__dirname));

const DB_URL = process.env.MONGO_URI;

if (DB_URL) {
    mongoose.connect(DB_URL)
        .then(() => console.log('🏛️ ВЕЧНАЯ БАЗА MONGODB ПОДКЛЮЧЕНА!'))
        .catch(err => {
            console.error('❌ Ошибка базы:', err);
            process.exit(1);
        });
} else {
    console.error('⚠️ КРИТИЧЕСКАЯ ОШИБКА: MONGO_URI не задан!');
    process.exit(1);
}

// Схема юзера с безопасным хранением пароля
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// Схема сообщений
const MessageSchema = new mongoose.Schema({
    sender: String,
    to: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

const activeUsers = {}; // username -> socket.id

// Функция для безопасного хеширования пароля встроенным crypto
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

io.on('connection', (socket) => {

    // Проверка ника: свободен, занят или нужен пароль
    socket.on('check nick', async (username) => {
        if (!username) return;
        try {
            const userExists = await User.findOne({ username: username.trim() });
            if (userExists) {
                socket.emit('nick status', { username, status: 'exists' });
            } else {
                socket.emit('nick status', { username, status: 'new' });
            }
        } catch (e) {
            console.error(e);
        }
    });

    // Регистрация нового или вход существующего
    socket.on('login or register', async (data) => {
        let { username, password } = data;
        if (!username || !password) return socket.emit('auth error', 'Заполните все поля!');
        
        username = username.trim();
        const hashedPassword = hashPassword(password); // Хешируем пароль

        try {
            let user = await User.findOne({ username: username });

            if (user) {
                // Сверяем безопасные хэши
                if (user.password === hashedPassword) {
                    socket.username = username;
                    activeUsers[username] = socket.id;
                    socket.emit('auth success', { username });
                    io.emit('update users', Object.keys(activeUsers));
                } else {
                    socket.emit('auth error', 'Неверный пароль для этого ника!');
                }
            } else {
                // Создаем нового пользователя с хэшем вместо чистого пароля
                user = new User({ username, password: hashedPassword });
                await user.save();

                socket.username = username;
                activeUsers[username] = socket.id;
                socket.emit('auth success', { username });
                io.emit('update users', Object.keys(activeUsers));
            }
        } catch (e) {
            console.error(e);
            socket.emit('auth error', 'Ошибка авторизации базы!');
        }
    });

    socket.on('get history', async (data) => {
        const myNick = socket.username || data.myNick;
        const target = data.target;
        if (!myNick || !target) return;

        try {
            let query = {};
            if (target === 'GLOBAL') {
                query = { to: 'GLOBAL' };
            } else {
                query = {
                    $or: [
                        { sender: myNick, to: target },
                        { sender: target, to: myNick }
                    ]
                };
            }

            const history = await Message.find(query).sort({ timestamp: 1 }).limit(100);
            socket.emit('load history', { target: target, history: history });
        } catch (e) {
            console.error(e);
        }
    });

    socket.on('send message', async (data) => {
        const senderName = socket.username || data.sender || 'Аноним';
        if (!data.text || !data.to) return;

        const msgData = {
            sender: senderName,
            to: data.to,
            text: data.text,
            timestamp: new Date()
        };

        try {
            const newMsg = new Message(msgData);
            await newMsg.save();
        } catch(e) { 
            console.error(e); 
            return; 
        }

        if (data.to === 'GLOBAL') {
            io.emit('new message', msgData);
        } else {
            const targetSocketId = activeUsers[data.to];
            if (targetSocketId) {
                io.to(targetSocketId).emit('new message', msgData);
            }
            socket.emit('new message', msgData);
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            if (activeUsers[socket.username] === socket.id) {
                delete activeUsers[socket.username];
            }
            io.emit('update users', Object.keys(activeUsers));
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('🚀 INANE 4.1 SECURE СЕРВЕР ЗАПУЩЕН НА ПОРТУ ' + PORT);
});

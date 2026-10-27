const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
const mongoose = require('mongoose');
const crypto = require('crypto');

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

const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
    sender: String,
    to: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

const activeUsers = {}; // username -> socket.id

const MAX_TEXT_LENGTH = 2000;
const MAX_NICK_LENGTH = 32;

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Ник должен быть непустой строкой разумной длины
function cleanNick(value) {
    if (typeof value !== 'string') return null;
    const nick = value.trim();
    if (!nick || nick.length > MAX_NICK_LENGTH) return null;
    return nick;
}

io.on('connection', (socket) => {

    socket.on('check nick', async (username) => {
        const nick = cleanNick(username);
        if (!nick) return;
        try {
            const userExists = await User.findOne({ username: nick });
            socket.emit('nick status', { username: nick, status: userExists ? 'exists' : 'new' });
        } catch (e) {
            console.error(e);
        }
    });

    socket.on('login or register', async (data) => {
        if (!data || typeof data.password !== 'string') {
            return socket.emit('auth error', 'Заполните все поля!');
        }
        const username = cleanNick(data.username);
        const password = data.password.trim();
        if (!username || !password) return socket.emit('auth error', 'Заполните все поля!');

        const hashedPassword = hashPassword(password);

        try {
            let user = await User.findOne({ username: username });

            if (user) {
                if (user.password !== hashedPassword) {
                    return socket.emit('auth error', 'Неверный пароль для этого ника!');
                }
            } else {
                user = new User({ username, password: hashedPassword });
                await user.save();
            }

            socket.username = username;
            activeUsers[username] = socket.id;
            socket.emit('auth success', { username });
            io.emit('update users', Object.keys(activeUsers));
        } catch (e) {
            console.error(e);
            socket.emit('auth error', 'Ошибка авторизации базы!');
        }
    });

    socket.on('get history', async (data) => {
        // Только для авторизованных: ник берём из сокета, а не от клиента
        const myNick = socket.username;
        const target = data && data.target;
        if (!myNick || typeof target !== 'string' || !target) return;

        try {
            let query;
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

            // Берём последние 100 сообщений и разворачиваем в хронологический порядок
            const history = await Message.find(query).sort({ timestamp: -1 }).limit(100);
            history.reverse();
            socket.emit('load history', { target: target, history: history });
        } catch (e) {
            console.error(e);
        }
    });

    socket.on('send message', async (data) => {
        // Только для авторизованных: отправитель — всегда ник из сокета
        const senderName = socket.username;
        if (!senderName) return;
        if (!data || typeof data.text !== 'string' || typeof data.to !== 'string' || !data.to) return;

        const text = data.text.trim();
        if (!text || text.length > MAX_TEXT_LENGTH) return;

        const msgData = {
            sender: senderName,
            to: data.to,
            text: text,
            timestamp: new Date()
        };

        try {
            const newMsg = new Message(msgData);
            await newMsg.save();
        } catch (e) {
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

    // ОБРАБОТЧИК КНОПКИ ВЫХОДА (LOGOUT)
    socket.on('logout', () => {
        if (socket.username) {
            console.log(`👤 Юзер ${socket.username} вышел из системы через Log Out`);
            if (activeUsers[socket.username] === socket.id) {
                delete activeUsers[socket.username];
            }
            delete socket.username;
            io.emit('update users', Object.keys(activeUsers));
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

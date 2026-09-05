const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

app.use(express.static(__dirname));

// ПОДКЛЮЧЕНИЕ К ВЕЧНОЙ БАЗЕ MONGODB ATLAS
const DB_URL = process.env.MONGO_URI || "mongodb+srv://grokmacedonyss_db_user:KDlPb05wGoMo9wIG@cluster0.lsmjb1n.mongodb.net/inane_db?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(DB_URL)
    .then(() => console.log('🏛️ ВЕЧНАЯ БАЗА MONGODB ПОДКЛЮЧЕНА УСПЕШНО!'))
    .catch(err => console.log('❌ Ошибка базы:', err));

// Схема сообщений
const MessageSchema = new mongoose.Schema({
    sender: String,
    to: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', MessageSchema);
const users = {};

io.on('connection', (socket) => {
    console.log('🟢 Новое подключение');

    // Сразу при подключении отдаем текущих пользователей онлайн
    socket.emit('update users', Object.keys(users));

    socket.on('register user', (username) => {
        if (!username) return;
        socket.username = username;
        users[username] = socket.id;
        io.emit('update users', Object.keys(users));
    });

    // ВЫГРУЗКА ИСТОРИИ ДЛЯ КОНКРЕТНОГО ЧАТА!
    socket.on('get history', async (data) => {
        const myNick = socket.username || data.myNick;
        const target = data.target;

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
            console.log("Ошибка истории:", e);
        }
    });

    // ОТПРАВКА СООБЩЕНИЯ (В ОБЩИЙ ИЛИ ЛИЧКУ)
    socket.on('send message', async (data) => {
        const senderName = socket.username || data.sender || 'Аноним';
        const msgData = {
            sender: senderName,
            to: data.to,
            text: data.text,
            timestamp: new Date()
        };

        // Сохраняем в вечную базу!
        try {
            const newMsg = new Message(msgData);
            await newMsg.save();
        } catch(e) { console.log(e); }

        if (data.to === 'GLOBAL') {
            io.emit('new message', msgData);
        } else {
            // Шлем только получателю и отправителю!
            const targetSocketId = users[data.to];
            if (targetSocketId) {
                io.to(targetSocketId).emit('new message', msgData);
            }
            socket.emit('new message', msgData);
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            delete users[socket.username];
            io.emit('update users', Object.keys(users));
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('🚀 INANE 4.0 СЕРВЕР ЗАПУЩЕН НА ПОРТУ ' + PORT);
});

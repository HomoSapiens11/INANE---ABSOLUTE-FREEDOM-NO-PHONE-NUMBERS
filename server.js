const express = require("express");
const http = require("http");
const cors = require("cors");
const socketIo = require("socket.io");
const mongoose = require("mongoose");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server);

// УНИВЕРСАЛЬНЫЙ СТРОКОВЫЙ КЛЮЧ-ДАТАБАЗ:
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:yW9wKmK3RNwKzq8b@cluster0.p7bd8.mongodb.net/chatDB?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
    .then(() => console.log('🚀 БАЗА MONGODB ПОДКЛЮЧЕНА УСПЕШНО!'))
    .catch(err => console.log('❌ Ошибка базы:', err));

// Схема сообщений для базы данных
const messageSchema = new mongoose.Schema({
    sender: String,
    to: String,
    text: String,
    isPrivate: Boolean,
    timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

// Хранилище юзеров в сети
const users = {};

io.on('connection', (socket) => {
    console.log(`🟢 Новое сокет-подключение: ${socket.id}`);

    // Регистрация юзера и выгрузка ЛИЧНОЙ истории
    socket.on('register user', async (username) => {
        if (!username) return;
        socket.username = username;
        users[username] = socket.id;

        console.log(`👤 Юзер "${username}" в сети (ID: ${socket.id})`);

        // Обновляем список пользователей
        io.emit('update users', Object.keys(users));

        // Выгружаем из базы все лички и сообщения
        try {
            if (mongoose.connection.readyState === 1) {
                const history = await Message.find({
                    $or: [
                        { isPrivate: false },
                        { sender: username },
                        { to: username }
                    ]
                }).sort({ timestamp: 1 }).limit(100);

                socket.emit('chat history', history);
            }
        } catch (e) {
            console.log('Ошибка выгрузки истории:', e);
        }
    });

    // 1. ОБЩИЕ СООБЩЕНИЯ
    socket.on('chat message', async (text) => {
        const senderName = socket.username || 'Аноним';

        // Живая отправка в чат, чтобы не было лагов!
        io.emit('chat message', {
            sender: senderName,
            text: text,
            isPrivate: false
        });

        // Сохранение в базу на фоне
        try {
            if (mongoose.connection.readyState === 1) {
                const newMsg = new Message({ sender: senderName, text: text, isPrivate: false });
                await newMsg.save();
            }
        } catch (e) { console.log(e); }
    });

    // 2. ПРИВАТНЫЕ ЛИЧКИ
    socket.on('private message', async (data) => {
        const senderName = socket.username || 'Аноним';
        const targetSocketId = users[data.to];

        if (targetSocketId) {
            // Личка получателю
            io.to(targetSocketId).emit('chat message', {
                sender: senderName,
                text: data.text,
                isPrivate: true
            });

            // Показываем у себя
            if (socket.id !== targetSocketId) {
                socket.emit('chat message', {
                    sender: senderName,
                    text: data.text,
                    isPrivate: true,
                    to: data.to
                });
            }
        } else {
            // Личка себе (ответ системы)
            socket.emit('chat message', {
                sender: 'СИСТЕМА',
                text: `Юзер "${data.to}" сейчас оффлайн, но сообщение СОХРАНЕНО В БАЗУ и прилетит ему при входе!`,
                isPrivate: true
            });
        }

        // Сохраняем личку в базу на фоне
        try {
            if (mongoose.connection.readyState === 1) {
                const newMsg = new Message({
                    sender: senderName,
                    to: data.to,
                    text: data.text,
                    isPrivate: true
                });
                await newMsg.save();
            }
        } catch (e) { console.log(e); }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            delete users[socket.username];
            io.emit('update users', Object.keys(users));
            console.log(`❌ Юзер "${socket.username}" вышел из сети.`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🔥 INANE 3.0 СЕРВЕР ЗАПУЩЕН НА ПОРТУ [${PORT}]`);
});

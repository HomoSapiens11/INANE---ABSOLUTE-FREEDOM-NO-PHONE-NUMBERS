const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ И МОДЕЛЬ MESSAGES
mongoose.connect('mongodb://localhost:27017/chatDB') // Замените на вашу строку подключения, если нужно
    .then(() => console.log('Успешное подключение к MongoDB'))
    .catch(err => console.error('Ошибка подключения к MongoDB:', err));

const messageSchema = new mongoose.Schema({
    sender: String,
    to: String,         // Заполняется только для приватных сообщений
    text: String,
    isPrivate: Boolean,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Хранилище активных пользователей: { 'имя_пользователя': 'socket.id' }
const users = {};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('Новое сокет-подключение:', socket.id);

    // Авторизация пользователя при входе
    socket.on('register user', async (username) => {
        if (!username) return;
        
        socket.username = username;
        users[username] = socket.id;

        // Обновляем список пользователей онлайн для всех
        io.emit('update users', Object.keys(users));
        console.log(`Пользователь зарегистрирован: ${username} (${socket.id})`);

        // ШАГ 2: ЗАГРУЗКА ИСТОРИИ ИЗ БАЗЫ ДАННЫХ ПРИ ВХОДЕ!
        try {
            // Достаем сообщения: либо публичные, либо приватные, где текущий юзер — отправитель или получатель
            const history = await Message.find({
                $or: [
                    { isPrivate: false },
                    { isPrivate: true, sender: username },
                    { isPrivate: true, to: username }
                ]
            }).sort({ timestamp: 1 }).limit(100); // Ограничим последними 100 сообщениями

            // Отправляем историю только вошедшему пользователю
            socket.emit('chat history', history);
        } catch (err) {
            console.error('Ошибка загрузки истории:', err);
        }
    });

    // 1. ОБЩИЙ ЧАТ
    socket.on('general message', async (data) => {
        const senderName = socket.username || 'Аноним';
        const text = data.text;

        const newMsg = new Message({ sender: senderName, text: text, isPrivate: false });
        await newMsg.save();

        io.emit('chat message', {
            sender: senderName,
            text: text,
            isPrivate: false
        });
    });

    // 2. ПРИВАТНЫЕ ЛИЧКИ
    socket.on('private message', async (data) => {
        const senderName = socket.username || 'Аноним';

        // Сохраняем ЛИЧКУ в полную базу НАВСЕГДА!
        const newMsg = new Message({
            sender: senderName,
            to: data.to,
            text: data.text,
            isPrivate: true
        });
        await newMsg.save();

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
            // Если юзер оффлайн - сообщение все равно в базе!
            socket.emit('chat message', {
                sender: 'СИСТЕМА',
                text: `Юзер "${data.to}" сейчас оффлайн, но сообщение СОХРАНЕНО В БАЗУ и прилетит ему при входе`,
                isPrivate: true
            });
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            delete users[socket.username];
            io.emit('update users', Object.keys(users));
            console.log(`User ${socket.username} вышел`);
        }
    });
});

server.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000');
});

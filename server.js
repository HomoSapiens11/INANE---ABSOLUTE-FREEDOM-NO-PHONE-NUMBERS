const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Раздаем статические файлы (включая index.html) из текущей папки
app.use(express.static(__dirname));

// Хранилище подключенных юзеров: { "Ник": "id_сокета" }
const users = {};

io.on('connection', (socket) => {
    console.log('🟢 Новое подключение к INANE');

    // Регистрация ника юзера на сервере
    socket.on('register user', (username) => {
        socket.username = username;
        users[username] = socket.id;
        console.log(`👤 Юзер ${username} в сети (ID: ${socket.id})`);
        io.emit('update users', Object.keys(users));
    });

    // 1. Обработка ОБЩИХ сообщений (из эфира)
    socket.on('chat message', (text) => {
        const senderName = socket.username || 'Аноним';
        
        io.emit('chat message', {
            sender: senderName,
            text: text,
            isPrivate: false
        });
    });

    // 2. Обработка ПРИВАТНЫХ сообщений (личка)
    socket.on('private message', (data) => {
        const senderName = socket.username || 'Аноним';
        const targetSocketId = users[data.to]; // Ищем ID сокета по нику получателя
        
        if (targetSocketId) {
            // Отправляем получателю
            io.to(targetSocketId).emit('chat message', {
                sender: senderName,
                text: data.text,
                isPrivate: true
            });
            
            // Если пишем не самому себе, отображаем и у отправителя в чате
            if (socket.id !== targetSocketId) {
                socket.emit('chat message', {
                    sender: senderName,
                    text: data.text,
                    isPrivate: true,
                    to: data.to // Чтобы на фронтенде загорелся тег "ЛИЧКА ДЛЯ..."
                });
            }
        } else {
            // Если юзер не найден или оффлайн — шлем системную ошибку отправителю
            socket.emit('chat message', {
                sender: 'СИСТЕМА',
                text: `Юзер "${data.to}" не найден или оффлайн!`,
                isPrivate: true
            });
        }
    });

    // Обработка отключения юзера
    socket.on('disconnect', () => {
        if (socket.username) {
            delete users[socket.username];
            io.emit('update users', Object.keys(users));
            console.log(`🔴 Юзер ${socket.username} вышел`);
        }
    });
});

// Настройка порта (для локального запуска и для деплоя на Render/Heroku)
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 INANE 2.0 СЕРВЕР ЗАПУЩЕН НА ПОРТУ ${PORT}`);
});

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Раздаем наш сайт из папки
app.use(express.static(__dirname));

// Слушаем подключения юзеров к INANE
io.on('connection', (socket) => {
    console.log('🟢 Кто-то подключился к INANE!');

    // Принимаем сообщение и рассылаем всем!
    socket.on('chat message', (msg) => {
        io.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log('🔴 Кто-то отключился');
    });
});

// Запускаем сервер на порту 3000
http.listen(3000, () => {
    console.log('🚀 СЕРВЕР INANE ЗАПУЩЕН НА http://localhost:3000');
});

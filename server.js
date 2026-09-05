const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// Исправлено: __dirname пишется с двумя подчеркиваниями
app.use(express.static(__dirname));

// ПОДКЛЮЧЕНИЕ К ТВОЕЙ ВЕЧНОЙ БАЗЕ MONGODB ATLAS
// Исправлено: имя переменной приведено к единому стилю DB_URL
const DB_URL = process.env.MONGOURI || "mongodb+srv://grokmacedonyssdbuser:KDlPb05wGoMo9wIG@cluster0.lsmjb1n.mongodb.net/inanedb?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(DB_URL)
    .then(() => console.log('🏛️ ВЕЧНАЯ БАЗА MONGODB ПОДКЛЮЧЕНА УСПЕШНО!'))
    .catch(err => console.log('❌ Ошибка базы:', err));

// Схема хранения сообщений в базе
const MessageSchema = new mongoose.Schema({
    sender: String,
    to: String,
    text: String,
    isPrivate: Boolean,
    timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', MessageSchema);

// Хранилище юзеров в сети
const users = {};

io.on('connection', (socket) => {
    console.log('🟢 Новое подключение к INANE 3.0');

    // Регистрация юзера и выгрузка ВЕЧНОЙ ИСТОРИИ
    socket.on('register user', async (username) => {
        if (!username) return;
        socket.username = username;
        users[username] = socket.id;
        console.log('👤 Юзер ' + username + ' в сети');
        
        io.emit('update users', Object.keys(users));

        // Выгружаем из базы ВСЕ лички и сообщения
        try {
            if (mongoose.connection.readyState === 1) {
                const history = await Message.find({
                    $or: [
                        { isPrivate: false },
                        { sender: username },
                        { to: username }
                    ]
                }).sort({ timestamp: 1 }).limit(100);

                socket.emit('load history', history);
            }
        } catch (e) {
            console.log("Ошибка выгрузки истории:", e);
        }
    });

    // 1. ОБЩИЕ СООБЩЕНИЯ
    socket.on('chat message', async (text) => {
        // Исправлено: добавлен оператор ||
        const senderName = socket.username || 'Аноним';
        
        // Сразу отправляем в чат!
        io.emit('chat message', {
            sender: senderName,
            text: text,
            isPrivate: false
        });

        // Сохраняем в базу на фоне
        try {
            if (mongoose.connection.readyState === 1) {
                const newMsg = new Message({ sender: senderName, text: text, isPrivate: false });
                await newMsg.save();
            }
        } catch(e) { console.log(e); }
    });

    // 2. ПРИВАТНЫЕ ЛИЧКИ
    socket.on('private message', async (data) => {
        // Исправлено: добавлен оператор ||
        const senderName = socket.username || 'Аноним';
        const targetSocketId = users[data.to];

        if (targetSocketId) {
            io.to(targetSocketId).emit('chat message', {
                sender: senderName,
                text: data.text,
                isPrivate: true
            });
            
            if (socket.id !== targetSocketId) {
                socket.emit('chat message', {
                    sender: senderName,
                    text: data.text,
                    isPrivate: true,
                    to: data.to
                });
            }
        } else {
            socket.emit('chat message', {
                sender: 'СИСТЕМА',
                text: 'Юзер "' + data.to + '" сейчас оффлайн, но сообщение СОХРАНЕНО В БАЗУ!',
                isPrivate: true
            });
        }

        // Сохраняем ЛИЧКУ в базу на фоне
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
        } catch(e) { console.log(e); }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            delete users[socket.username];
            io.emit('update users', Object.keys(users));
            console.log('🔴 Юзер ' + socket.username + ' вышел');
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('🚀 INANE 3.0 СЕРВЕР ЗАПУЩЕН НА ПОРТУ ' + PORT);
});

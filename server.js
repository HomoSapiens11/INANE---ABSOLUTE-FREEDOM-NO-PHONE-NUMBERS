const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

app.use(express.static(__dirname));

// ПОДКЛЮЧЕНИЕ К ТВОЕЙ ВЕЧНОЙ БАЗЕ MONGODB ATLAS
const DB_URL = process.env.MONGO_URI || "mongodb+srv://grokmacedonyss_db_user:KDlPb05wGoMo9wIG@cluster0.lsmjb1n.mongodb.net/inane_db?retryWrites=true&w=majority&appName=Cluster0";

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

io.on('connection', async (socket) => {
    console.log('🟢 Новое подключение к INANE 3.0');

    // СРАЗУ ПРИ ВХОДЕ ВЫГРУЖАЕМ ОБЩУЮ ИСТОРИЮ (публичные сообщения)
    try {
        if (mongoose.connection.readyState === 1) {
            const publicHistory = await Message.find({ isPrivate: false })
                .sort({ timestamp: 1 })
                .limit(100);
            
            socket.emit('load history', publicHistory);
        }
    } catch (e) {
        console.log("Ошибка выгрузки общей истории при подключении:", e);
    }

    // Регистрация юзера и довыгрузка ПРИВАТНОЙ ИСТОРИИ
    socket.on('register user', async (username) => {
        if (!username) return;
        
        socket.username = username;
        users[username] = socket.id;
        console.log('👤 Юзер ' + username + ' в сети');
        
        io.emit('update users', Object.keys(users));

        // Выгружаем только приватные сообщения, связанные с этим пользователем
        try {
            if (mongoose.connection.readyState === 1) {
                const privateHistory = await Message.find({
                    isPrivate: true,
                    $or: [
                        { sender: username },
                        { to: username }
                    ]
                }).sort({ timestamp: 1 }).limit(100);

                // Отправляем приватную историю. Фронтенд просто дорендерит её сверху или снизу
                socket.emit('load history', privateHistory);
            }
        } catch (e) {
            console.log("Ошибка выгрузки личной истории:", e);
        }
    });

    // 1. ОБЩИЕ СООБЩЕНИЯ
    socket.on('chat message', async (text) => {
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

const express = require('express');
const app = express();
const http = require('http').createServer(app);
// Настройка CORS (опционально, но полезно для Render)
const io = require('socket.io')(http, {
  cors: { origin: "*" }
});
const mongoose = require('mongoose');

app.use(express.static(__dirname));

const DB_URL = process.env.MONGO_URI;
if (DB_URL) {
  mongoose.connect(DB_URL)
    .then(() => console.log('🏛️ БАЗА MONGODB ПОДКЛЮЧЕНА!'))
    .catch(err => {
      console.error('❌ Ошибка подключения к базе:', err);
      process.exit(1); // Останавливаем сервер, если БД недоступна
    });
} else {
  console.error('⚠️ КРИТИЧЕСКАЯ ОШИБКА: MONGO_URI не задан в переменных окружения!');
  process.exit(1);
}

// Схема сообщений
const MessageSchema = new mongoose.Schema({
  sender: String,
  to: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// Хранилище активных пользователей: { username: socketId }
const users = {};

io.on('connection', (socket) => {
  
  // Регистрация или перерегистрация пользователя
  socket.on('register user', (username) => {
    if (!username) return;
    
    // Если этот ник уже был привязан к другому socket.id, обновляем его
    socket.username = username;
    users[username] = socket.id;
    
    io.emit('update users', Object.keys(users));
  });

  // Получение истории сообщений
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
      console.error("Ошибка загрузки истории:", e);
    }
  });

  // Отправка сообщения
  socket.on('send message', async (data) => {
    const senderName = socket.username || data.sender || 'Аноним';
    
    // Защита от отправки пустого текста
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
      console.error("Ошибка сохранения в БД:", e);
      return; // Не отправляем сообщение в чат, если оно не сохранилось в БД
    }

    if (data.to === 'GLOBAL') {
      io.emit('new message', msgData);
    } else {
      const targetSocketId = users[data.to];
      
      // Отправляем получателю, если он в сети
      if (targetSocketId) {
        io.to(targetSocketId).emit('new message', msgData);
      }
      
      // Отправляем обратно отправителю (для подтверждения доставки/отображения)
      socket.emit('new message', msgData);
    }
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    if (socket.username) {
      // Удаляем пользователя только если его текущий socket.id совпадает с сохраненным
      if (users[socket.username] === socket.id) {
        delete users[socket.username];
      }
      io.emit('update users', Object.keys(users));
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log('🚀 БЕЗОПАСНЫЙ СЕРВЕР СТАРТОВАЛ НА ПОРТУ ' + PORT);
});

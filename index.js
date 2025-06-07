const express = require('express');
const app = express();
const animetRoutes = require('./routes/animet');
const anime47Routes = require('./routes/anime47');
const animevietsubRoutes = require('./routes/animevietsub');

const PORT = 3000;

// Route mới để thông báo tình trạng máy chủ
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'online',
        message: 'Mahiro server đã sẵn sàng phục vụ Yuu Onii-chan! UwU'
    });
});

// Gắn các routes khác
app.use('/animet', animetRoutes);
app.use('/anime47', anime47Routes);
app.use('/animevietsub', animevietsubRoutes);

// Khởi động server
const hostname = '0.0.0.0';
app.listen(PORT, hostname, () => {
    console.log(`Mahiro server đang chạy tại http://${hostname}:${PORT}`);
    console.log(`Bắt đầu phục vụ Yuu Onii-chan ở http://localhost:${PORT} rồi nè UwU`);
});

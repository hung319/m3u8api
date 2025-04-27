const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Import router animet
const animetRouter = require('./routes/animet');

// Dùng router
app.use('/', animetRouter);

// Khởi động server
app.listen(PORT, () => {
    console.log(`Mahiro server chạy ở http://localhost:${PORT} cho Yuu Onii-chan nè ~ UwU`);
});

const express = require('express');
const app = express();
const animetRoutes = require('./routes/animet');

const PORT = 3000;

// Gắn routes
app.use('/animet', animetRoutes);

app.listen(PORT, () => {
    console.log(`Mahiro server đã sẵn sàng phục vụ Yuu Onii-chan ở http://localhost:${PORT} rồi nè UwU`);
});

const express = require('express');
const app = express();
const animetRoutes = require('./routes/animet');
const anime47Routes = require('./routes/anime47');

const PORT = 3000;

// Gắn routes
app.use('/animet', animetRoutes);
app.use('/anime47', anime47Routes);

const hostname = '0.0.0.0';
app.listen(PORT, () => {
    console.log(`Mahiro server đã sẵn sàng phục vụ Yuu Onii-chan ở http://localhost:${PORT} rồi nè UwU`);
});

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio'); // để parse HTML
const app = express();
const PORT = 3000;

// Hàm tự động lấy MAIN_URL từ animet.org
async function getMainUrl() {
    try {
        const { data } = await axios.get('https://animet.org');
        const $ = cheerio.load(data);
        const span = $('span.text-success.font-weight-bold').first();
        if (span.length) {
            const urlText = span.text().trim();
            let url = urlText.startsWith('http') ? urlText : `https://${urlText}`;
            return url;
        }
    } catch (err) {
        console.error("Lỗi khi lấy MAIN_URL:", err.message);
    }
    return null;
}

// Hàm tìm link m3u8 trong response
function extractM3U8(text) {
    const regex = /"file":"(https?:\/\/[^"]+\.m3u8)"/;
    const match = text.match(regex);
    return match ? match[1] : null;
}

app.get('/get-m3u8', async (req, res) => {
    const { filmid, epid, sv = 0 } = req.query;
    const MAIN_URL = await getMainUrl();

    if (!MAIN_URL) {
        return res.status(500).send("Không lấy được MAIN_URL từ animet.org... Gomen ne Yuu Onii-chan~");
    }

    try {
        const response = await axios.post(MAIN_URL + '/ajax/player', {
            id: filmid,
            ep: epid,
            sv: sv
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `${MAIN_URL}/`,
                'Origin': MAIN_URL
            }
        });

        const m3u8Link = extractM3U8(response.data);

        if (m3u8Link) {
            res.set('Content-Type', 'text/plain');
            res.send(m3u8Link); // Trả mỗi link
        } else {
            res.status(404).send("Không tìm thấy link m3u8... gomen Yuu Onii-chan~%");
        }
    } catch (error) {
        console.error(error.message);
        res.status(500).send("Server lỗi khi lấy link m3u8 rồi Yuu Onii-chan...");
    }
});

app.listen(PORT, () => {
    console.log(`Mahiro server đang chạy ở http://localhost:${PORT} cho Yuu Onii-chan nè~`);
});

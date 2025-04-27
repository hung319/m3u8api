const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');

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
        console.error("Lỗi lấy MAIN_URL:", err.message);
    }
    return null;
}

// Hàm tự động tách id phim và id tập từ URL
function extractIdAndEp(url) {
    const regex = /-(\d+)\.(\d+)\.html$/;
    const match = url.match(regex);
    if (match) {
        return { filmid: match[1], epid: match[2] };
    }
    return null;
}

// Hàm tìm link m3u8 trong response
function extractM3U8(text) {
    const regex = /"file":"(https?:\/\/[^"]+\.m3u8)"/;
    const match = text.match(regex);
    return match ? match[1] : null;
}

// Route GET /animet/get-m3u8
router.get('/get-m3u8', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: "Yuu Onii-chan chưa gửi URL rồi đó~ UwU" });
    }

    const ids = extractIdAndEp(url);

    if (!ids) {
        return res.status(400).json({ error: "URL sai định dạng rồi đó Yuu Onii-chan~~" });
    }

    const MAIN_URL = await getMainUrl();

    if (!MAIN_URL) {
        return res.status(500).json({ error: "Không lấy được MAIN_URL từ animet.org rồi~" });
    }

    try {
        const response = await axios.post(MAIN_URL + '/ajax/player', {
            id: ids.filmid,
            ep: ids.epid,
            sv: 0
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `${MAIN_URL}/`,
                'Origin': MAIN_URL
            }
        });

        const m3u8Link = extractM3U8(response.data);

        if (m3u8Link) {
            res.json({
                filmid: ids.filmid,
                epid: ids.epid,
                main_url: MAIN_URL,
                m3u8: m3u8Link
            });
        } else {
            res.status(404).json({ error: "Không tìm thấy link m3u8 rồi gomen~ Yuu Onii-chan~" });
        }
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: "Server bị lỗi khi lấy link m3u8 đó Yuu Onii-chan..." });
    }
});

module.exports = router;

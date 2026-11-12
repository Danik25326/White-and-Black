// Vercel serverless function: збирає свіжі матеріали з українських сайтів (RSS) і музику за настроєм.
// Працює без CORS-проблем, бо запити йдуть із сервера. Виклик: /api/mood?kind=white|black|gray
const SRC = {
  sus: { name: 'Суспільне', rss: 'https://suspilne.media/rss/all.rss' },
  uin: { name: 'Укрінформ', rss: 'https://www.ukrinform.ua/rss/block-lastnews' },
  upn: { name: 'Українська правда', rss: 'https://www.pravda.com.ua/rss/view_news/' },
  upa: { name: 'Українська правда', rss: 'https://www.pravda.com.ua/rss/view_articles/' },
  tsn: { name: 'ТСН', rss: 'https://tsn.ua/rss/full.rss' },
  hro: { name: 'Громадське', rss: 'https://hromadske.ua/rss' },
  ukr: { name: 'Ukrainer', rss: 'https://ukrainer.net/feed/' },
  chy: { name: 'Читомо', rss: 'https://chytomo.com/feed/' },
  lif: { name: 'УП. Життя', rss: 'https://life.pravda.com.ua/rss/' }
};
const MOODS = {
  white: { re: /перемог|врятув|рекорд|відкри|допомог|подарув|свято|нагород|успіх|створи|запуст|повернул|добр|натхн|діти|мрі|усміх|фестивал|концерт|мистецтв/i, news: ['sus', 'uin', 'upn', 'tsn'], stories: ['ukr', 'lif', 'chy', 'upa'], artists: ['Go_A', 'KAZKA', 'Tvorchi', 'Alyona Alyona', 'Jerry Heil', 'The Hardkiss'] },
  black: { re: /загин|втрат|трагед|смерт|помер|поховал|жертв|поранен|обстріл|горе|сумн|самотн|вигоран|депрес|біль|зникл|катастроф|пожеж|вбив|пам.ят/i, news: ['sus', 'uin', 'upn', 'tsn', 'hro'], stories: ['ukr', 'lif', 'chy', 'upa'], artists: ['Скрябін', 'Христина Соловій', 'Latexfauna', 'Один в каное', 'Артем Пивоваров', 'Pianoboy'] },
  gray: { re: /наук|космос|природ|філософ|історі|дослідж|книг|культур|еколог|заповідник|тварин|астроном|лісів|гори|карпат/i, news: ['sus', 'uin', 'upn', 'hro'], stories: ['ukr', 'chy', 'lif', 'upa'], artists: ['ДахаБраха', 'Vivienne Mort', 'Тінь Сонця', 'Океан Ельзи', 'Антитіла'] }
};
const strip = (h) => String(h || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function parse(xml, source) {
  return (xml.match(/<item[\s>][\s\S]*?<\/item>/g) || []).map((b) => {
    const g = (t) => { const m = b.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return m ? strip(m[1]) : ''; };
    return { title: g('title'), snippet: g('description').slice(0, 160), url: g('link'), date: new Date(g('pubDate') || Date.now()).toISOString(), source };
  }).filter((i) => i.title && i.url);
}
async function feed(key) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(SRC[key].rss, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; BileChorne/1.0)' } });
    return parse(await r.text(), SRC[key].name);
  } catch (e) { return []; } finally { clearTimeout(timer); }
}
async function pick(keys, re, limit) {
  const all = (await Promise.all(keys.map(feed))).flat().sort((a, b) => new Date(b.date) - new Date(a.date));
  const match = all.filter((i) => re.test(i.title + ' ' + i.snippet));
  const seen = new Set(), out = [];
  for (const i of [...match, ...all.filter((i) => !match.includes(i))]) { if (seen.has(i.title)) continue; seen.add(i.title); out.push(i); if (out.length >= limit) break; }
  return out;
}
async function tracks(artists) {
  const all = [];
  await Promise.all(artists.map(async (a) => {
    try {
      const j = await (await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(a)}&country=UA&media=music&entity=song&attribute=artistTerm&limit=8`)).json();
      all.push(...j.results.filter((r) => r.previewUrl));
    } catch (e) {}
  }));
  const seen = new Set(), out = [];
  for (const r of all.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate))) {
    if (seen.has(r.trackName)) continue; seen.add(r.trackName);
    out.push({ trackName: r.trackName, artistName: r.artistName, artworkUrl100: r.artworkUrl100, previewUrl: r.previewUrl });
  }
  return out.slice(0, 8);
}
module.exports = async (req, res) => {
  const m = MOODS[req.query.kind] || MOODS.gray;
  const [news, stories, music] = await Promise.all([pick(m.news, m.re, 8), pick(m.stories, m.re, 8), tracks(m.artists)]);
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ news, stories, tracks: music });
};

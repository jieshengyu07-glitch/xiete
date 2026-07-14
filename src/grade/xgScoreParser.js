const cheerio = require("cheerio");

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseXgStudentScores(html) {
  if (!html || typeof html !== "string") {
    console.log("[xg-parser] step=parse hasGridView1=false rows=0");
    return [];
  }

  const $ = cheerio.load(html);
  const table = $("#GridView1");
  if (!table.length) {
    console.log("[xg-parser] step=parse hasGridView1=false rows=0");
    return [];
  }

  const scores = [];
  table.find("tr").each((index, row) => {
    if (index === 0) return;
    const cells = $(row).find("td");
    if (cells.length < 7) return;

    const item = {
      studentId: cleanText($(cells[0]).text()),
      name: cleanText($(cells[1]).text()),
      courseName: cleanText($(cells[2]).text()),
      courseType: cleanText($(cells[3]).text()),
      score: cleanText($(cells[4]).text()),
      credit: cleanText($(cells[5]).text()),
      term: cleanText($(cells[6]).text()),
      source: "xg"
    };

    if (item.courseName && item.score) scores.push(item);
  });

  console.log("[xg-parser] step=parse hasGridView1=true rows=" + scores.length);
  return scores;
}

module.exports = {
  parseXgStudentScores,
  cleanText
};

const config = require("../config");

class GradeQuery {
  constructor(axiosClient) {
    this.client = axiosClient;
  }

  async query(xnm, xqm) {
    // 先访问成绩查询页面（建立模块会话，否则API返回302）
    try {
      await this.client.get(
        config.urls.jwxt.base + "/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default",
        { validateStatus: s => true, maxRedirects: 0 }
      );
    } catch(e) {}

    const url = config.urls.jwxt.base + config.urls.jwxt.gradeQuery;
    const formData = { xnm, xqm };

    console.log(`[成绩] 查询 ${xnm} 学年 第${xqm}学期 成绩...`);

    try {
      const response = await this.client.post(url, new URLSearchParams(formData).toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": config.urls.jwxt.base + "/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default",
        },
        maxRedirects: 5,
        validateStatus: s => s < 400,
      });

      const data = response.data;
      let grades = [];

      if (Array.isArray(data)) grades = data;
      else if (data.items) grades = data.items;
      else if (data.rows) grades = data.rows;

      return grades.map(g => ({
        xnm: g.XNM || g.xnm || xnm,
        xqm: g.XQM || g.xqm || xqm,
        kch: g.KCH || g.kch || "",
        kcmc: g.KCMC || g.kcmc || "",
        kcxz: g.KCXZ || g.kcxz || "",
        xf: g.XF || g.xf || "",
        cj: g.CJ || g.cj || "",
        cjBj: g.CJBJ || g.cjbj || "",
        jd: g.JD || g.jd || "",
        cjXz: g.CJXZ || g.cjxz || "",
        kkxy: g.KKXY || g.kkxy || "",
        jsxx: g.JSXX || g.jsxx || "",
        khfs: g.KHFS || g.khfs || "",
        xh: g.XH || g.xh || "",
        xm: g.XM || g.xm || "",
        raw: g,
      }));
    } catch (err) {
      console.error(`[成绩] ❌ 查询失败:`, err.message);
      if (err.response) console.error(`[成绩] 状态码: ${err.response.status}`);
      return [];
    }
  }

  async queryAll() {
    const terms = [
      { xnm: "2025-2026", xqm: "2" },
      { xnm: "2025-2026", xqm: "1" },
    ];
    const allGrades = [];
    for (const term of terms) {
      const grades = await this.query(term.xnm, term.xqm);
      allGrades.push(...grades);
    }
    return allGrades;
  }
}

module.exports = GradeQuery;

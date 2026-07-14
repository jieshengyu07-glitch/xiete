const { parseXgStudentScores } = require("../src/grade/xgScoreParser");

const html = `
<table id="GridView1">
  <tr>
    <td>学号</td><td>姓名</td><td>课程名称</td><td>课程类型</td><td>成绩</td><td>学分</td><td>学期</td>
  </tr>
  <tr>
    <td><a href="xxx">202324030212</a></td>
    <td>&nbsp;</td>
    <td>汽车电器与电子控制技术</td>
    <td><span style="color:red;">必修</span></td>
    <td style="color:Green;">77.00</td>
    <td style="color:Green;">2.00</td>
    <td>2025-2026学年第2学期</td>
  </tr>
  <tr>
    <td><a href="xxx">202324030212</a></td>
    <td>&nbsp;</td>
    <td>汽车理论与运用</td>
    <td><span style="color:red;">必修</span></td>
    <td style="color:Green;">60.00</td>
    <td style="color:Green;">2.50</td>
    <td>2025-2026学年第2学期</td>
  </tr>
</table>
`;

const scores = parseXgStudentScores(html);
console.log("count=" + scores.length);
scores.forEach(item => {
  console.log(item.courseName + " / " + item.score + " / " + item.credit);
});

if (scores.length !== 2) {
  throw new Error("Expected 2 scores");
}
if (scores[0].courseName !== "汽车电器与电子控制技术" || scores[0].score !== "77.00" || scores[0].credit !== "2.00") {
  throw new Error("First score parsed incorrectly");
}
if (scores[1].courseName !== "汽车理论与运用" || scores[1].score !== "60.00" || scores[1].credit !== "2.50") {
  throw new Error("Second score parsed incorrectly");
}

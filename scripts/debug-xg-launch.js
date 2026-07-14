const { debugXgLaunch } = require("../src/grade/xgSession");

debugXgLaunch()
  .then(result => {
    if (!result.xgSessionEstablished) {
      process.exitCode = 2;
    }
  })
  .catch(err => {
    const code = err && err.code ? err.code : "DEBUG_XG_LAUNCH_FAILED";
    console.log("portalLogin=false");
    console.log("xgAppFound=false");
    console.log("ssoLaunchStarted=false");
    console.log("xgAuthReached=false");
    console.log("thirdpartycasReached=false");
    console.log("choosePersonReached=false");
    console.log("personChooseAnalyzed=false");
    console.log("personSelected=false");
    console.log("xgHomeReached=false");
    console.log("xgHomeApiValid=false");
    console.log("xgSessionEstablished=false");
    console.log("thirdpartycasFound=false");
    console.log("errorCode=" + code);
    process.exitCode = 1;
  });

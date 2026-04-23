/**
 * 最終解決版：記号・全角半角・特殊文字をすべて排除して比較
 */
function doPost(e) {
  try {
    const contents = JSON.parse(e.postData.contents);
    const userName = contents.userName || "Unknown";
    const dataList = contents.scores || []; 
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    const constSheet = ss.getSheetByName('譜面定数表');
    if (!constSheet) return ContentService.createTextOutput("Error: 譜面定数表なし");
    
    const constValues = constSheet.getDataRange().getValues();
    const constMap = new Map();
    
    // 文字列を「英数字と日本語のみ」に削ぎ落とす関数
    const cleanKey = (str) => {
      if (!str) return "";
      // 1. 全角を半角にする
      const half = str.replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
      // 2. スペース、中黒、記号、句読点をすべて削除（漢字・ひらがな・カタカナ・英数字以外を消す）
      return half.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, "").toLowerCase();
    };

    // 1. 定数表の読み込み
    for (let i = 0; i < constValues.length; i++) {
      const normalizedKey = cleanKey(String(constValues[i][0]));
      const val = parseFloat(constValues[i][4]); 
      if (normalizedKey) {
        constMap.set(normalizedKey, val);
      }
    }

    let sheet = ss.getSheetByName(userName);
    if (!sheet) {
      sheet = ss.insertSheet(userName);
      sheet.appendRow(["更新日時", "曲名", "難易度", "レベル", "テクニカルスコア", "Pスコア", "Pスコア理論値", "譜面定数", "PスコアRating", "FB", "Combo", "Rank", "単曲レート"]);
    }
    
    let fullData = sheet.getDataRange().getValues();
    const rowMap = new Map();
    for (let i = 1; i < fullData.length; i++) {
      rowMap.set(fullData[i][1] + "|" + fullData[i][2], i);
    }
    
    const now = new Date();
    const newRows = [];

    // 2. データ処理ループ
    dataList.forEach(data => {
      if (data.title.includes("ソロver.") || data.title.includes("ソロ")) return;

      // 送信データ側も徹底的にクリーンアップ
      const searchKey = cleanKey(data.title + data.difficulty + data.level);
      
      let constant = constMap.get(searchKey);
      let displayConstant = constant || "未発見:" + searchKey;

      const key = data.title + "|" + data.difficulty;
      const index = rowMap.get(key);

      let star = 0;
      if (data.platinumMax > 0) {
        const rate = data.platinumScore / data.platinumMax;
        if (rate >= 0.98) star = 5;
        else if (rate >= 0.97) star = 4;
        else if (rate >= 0.96) star = 3;
        else if (rate >= 0.95) star = 2;
        else if (rate >= 0.94) star = 1;
      }
      
      const techRating = calculateTechRating(data.technicalScore, constant || 0, data.fbLamp, data.comboLamp, data.rankLamp);

      const rowData = [
        now, data.title, data.difficulty, data.level,
        data.technicalScore, data.platinumScore, data.platinumMax, 
        displayConstant, 
        `=( ${star} * (IF(ISNUMBER(H${index ? index+1 : fullData.length + newRows.length + 1}), H${index ? index+1 : fullData.length + newRows.length + 1}, 0)^2) ) / 1000`, 
        data.fbLamp ? "FB" : "", data.comboLamp, data.rankLamp, techRating
      ];

      if (index !== undefined) fullData[index] = rowData;
      else newRows.push(rowData);
    });

    const finalData = fullData.concat(newRows);
    sheet.getRange(1, 1, finalData.length, 13).setValues(finalData);
    
    return ContentService.createTextOutput("Success");
  } catch (err) {
    return ContentService.createTextOutput("Failed: " + err.toString());
  }
}


/**
 * 単曲Rating(Tech)の計算ロジック
 */
function calculateTechRating(score, constant, isFb, combo, rank) {
  const s = Number(score);
  const c = Number(constant);
  if (s < 800000 || c === 0) return 0;
  
  let base = 0;
  if (s >= 1010000) base = c + 2.0 + (s - 1010000) / 10 * 0.001;
  else if (s >= 1007500) base = c + 1.75 + (s - 1007500) / 10 * 0.001;
  else if (s >= 1000000) base = c + 1.25 + (s - 1000000) / 15 * 0.001;
  else if (s >= 990000) base = c + 0.75 + (s - 990000) / 20 * 0.001;
  else if (s >= 970000) base = c + 0.0 + (s - 970000) / (80/3) * 0.001;
  else if (s >= 900000) base = c - 4.0 + (s - 900000) / 17.5 * 0.001;
  else if (s >= 800000) base = c - 6.0 + (s - 800000) / 50 * 0.001;
  
  let bonus = 0;
  if (isFb) bonus += 0.050;
  if (combo === "AB+") bonus += 0.350;
  else if (combo === "AB") bonus += 0.300;
  else if (combo === "FC") bonus += 0.100;
  
  if (rank === "SSS+") bonus += 0.300;
  else if (rank === "SSS") bonus += 0.200;
  else if (rank === "SS") bonus += 0.100;
  
  return Math.floor((base + bonus + 0.000001) * 1000) / 1000;
}

/**
 * キャッシュ対応・高速読み込み版 doGet
 */
function doGet(e) {
  const cache = CacheService.getScriptCache();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    const user = e.parameter.user;

    // --- 1. ユーザー一覧の取得 ---
    if (!user) {
      const listCacheKey = "user_list_all";
      const cachedList = cache.get(listCacheKey);
      if (cachedList) return createResponse(JSON.parse(cachedList));

      const sheets = ss.getSheets();
      const list = sheets.map(s => s.getName()).filter(n => !["譜面定数表", "Sheet1", "DebugLog"].includes(n));

      try { cache.put(listCacheKey, JSON.stringify(list), 21600); } catch (e) { }
      return createResponse(list);
    }

    // --- 2. 個別データの取得 ---
    const dataCacheKey = "data_" + user;
    const cachedData = cache.get(dataCacheKey);
    if (cachedData) return createResponse(JSON.parse(cachedData));

    const sheet = ss.getSheetByName(user);
    if (!sheet) return createResponse({ error: "Sheet not found" });

    const values = sheet.getDataRange().getValues();
    const data = values.slice(1).map(row => ({
      title: row[1],
      difficulty: row[2],
      level: row[3],
      technicalScore: row[4],    // Tech版で使用
      platinumScore: row[5],     // P版で使用
      platinumMax: row[6],       // P版で使用
      constant: row[7],
      platinumScoreRating: row[8], // P版で使用
      fbLamp: row[9],            // Tech版で使用
      comboLamp: row[10],         // Tech版で使用
      techScoreRating: row[11]   // Tech版で使用
    }));

    const jsonData = JSON.stringify(data);

    // --- 【重要】キャッシュサイズチェック ---
    // GASのキャッシュは1項目100KB制限があるため、約90KB(90,000文字)以下の場合のみ保存
    if (jsonData.length < 90000) {
      try {
        cache.put(dataCacheKey, jsonData, 1200); // 20分間
      } catch (err) {
        console.warn("キャッシュ保存に失敗しました（サイズ等）: " + err.message);
      }
    }

    return createResponse(data);

  } catch (err) {
    // 内部エラーが起きても必ずJSON形式で返す（CORSエラー防止）
    return createResponse({ error: err.toString() });
  }
}

/**
 * レスポンス作成用共通関数
 */
function createResponse(content) {
  const output = typeof content === "string" ? content : JSON.stringify(content);
  return ContentService.createTextOutput(output)
    .setMimeType(ContentService.MimeType.JSON);
}

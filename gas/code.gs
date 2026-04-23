/**
 * ブックマークレットからのデータ受信（POST）
 * 譜面定数直接引き当て ＆ レート計算実装版
 */
function doPost(e) {
  const contents = JSON.parse(e.postData.contents);
  const userName = contents.userName || "Unknown";
  const dataList = contents.scores || []; 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. 譜面定数表をメモリにロード（A列：キー、E列：定数）
  const constSheet = ss.getSheetByName('譜面定数表');
  const constValues = constSheet.getDataRange().getValues();
  const constMap = new Map();
  for (let i = 0; i < constValues.length; i++) {
    const rowKey = String(constValues[i][0]).trim(); // A列: タイトル+難易度+レベル
    const val = parseFloat(constValues[i][4]);      // E列: 譜面定数
    if (rowKey) constMap.set(rowKey, val);
  }

  // 2. ユーザー用シートの準備
  let sheet = ss.getSheetByName(userName);
  if (!sheet) {
    sheet = ss.insertSheet(userName);
    sheet.appendRow(["更新日時", "曲名", "難易度", "レベル", "テクニカルスコア", "Pスコア", "Pスコア理論値", "譜面定数", "PスコアRating", "FB", "Combo", "Rank", "単曲レート"]);
  }
  
  let fullData = sheet.getDataRange().getValues();
  const rowMap = new Map();
  for (let i = 1; i < fullData.length; i++) {
    const key = fullData[i][1] + "|" + fullData[i][2]; // 曲名|難易度
    rowMap.set(key, i);
  }
  
  const now = new Date();
  const newRows = [];

  // 3. データ処理ループ
  dataList.forEach(data => {
    // 譜面定数の直接取得
    const lookupKey = data.title + data.difficulty + data.level;
    const constant = constMap.get(lookupKey) || 0;

    const key = data.title + "|" + data.difficulty;
    const index = rowMap.get(key);

    // Pスコア用の★判定
    let star = 0;
    if (data.platinumMax > 0) {
      const rate = data.platinumScore / data.platinumMax;
      if (rate >= 0.98) star = 5;
      else if (rate >= 0.97) star = 4;
      else if (rate >= 0.96) star = 3;
      else if (rate >= 0.95) star = 2;
      else if (rate >= 0.94) star = 1;
    }

    const fbStatus = data.fbLamp ? "FB" : "";
    const comboStatus = data.comboLamp || "None";
    const rankStatus = data.rankLamp || "None";

    // テクニカルレートの計算（確定したconstantを使用）
    const techRating = calculateTechRating(data.technicalScore, constant, data.fbLamp, comboStatus, rankStatus);

    if (index !== undefined) {
      // 既存データの更新
      const r = index + 1;
      const ratingPFormula = `=( ${star} * (H${r}^2) ) / 1000`;
      
      fullData[index] = [
        now, data.title, data.difficulty, data.level,
        data.technicalScore, data.platinumScore, data.platinumMax, 
        constant, // 数値として直接上書き
        ratingPFormula,
        fbStatus, comboStatus, rankStatus, techRating
      ];
    } else {
      // 新規曲の追加
      const r = fullData.length + newRows.length + 1;
      const ratingPFormula = `=( ${star} * (H${r}^2) ) / 1000`;
      
      newRows.push([
        now, data.title, data.difficulty, data.level,
        data.technicalScore, data.platinumScore, data.platinumMax, 
        constant, // 直接数値をいれる
        ratingPFormula,
        fbStatus, comboStatus, rankStatus, techRating
      ]);
    }
  });

  // 4. まとめて書き込み（M列：13列目まで）
  const finalData = fullData.concat(newRows);
  sheet.getRange(1, 1, finalData.length, 13).setValues(finalData);

  // キャッシュクリア
  const cache = CacheService.getScriptCache();
  cache.remove("data_" + userName);
  cache.remove("user_list_all");
  
  return ContentService.createTextOutput("Success");
}

/**
 * 単曲Rating(Tech)の計算ロジック（定数加算＆切り捨て修正版）
 */
function calculateTechRating(score, constant, isFb, combo, rank) {
  const s = Number(score);
  const c = Number(constant);
  
  // 80万点未満はレート対象外（0）
  if (s < 800000) return 0;
  
  let base = 0;
  
  // 1. ベース値の計算（譜面定数 c を基点に加算）
  if (s >= 1010000) {
    // 101万〜：定数+2.0 + (10につき0.001)
    base = c + 2.0 + (s - 1010000) / 10 * 0.001;
  } else if (s >= 1007500) {
    // 100.75万〜：定数+1.75 + (10につき0.001)
    base = c + 1.75 + (s - 1007500) / 10 * 0.001;
  } else if (s >= 1000000) {
    // 100万〜：定数+1.25 + (15につき0.001)
    base = c + 1.25 + (s - 1000000) / 15 * 0.001;
  } else if (s >= 990000) {
    // 99万〜：定数+0.75 + (20につき0.001)
    base = c + 0.75 + (s - 990000) / 20 * 0.001;
  } else if (s >= 970000) {
    // 97万〜：定数±0.0 + (26.666...につき0.001)
    base = c + 0.0 + (s - 970000) / (80/3) * 0.001;
  } else if (s >= 900000) {
    // 90万〜：定数-4.0 + (17.5につき0.001)
    base = c - 4.0 + (s - 900000) / 17.5 * 0.001;
  } else if (s >= 800000) {
    // 80万〜：定数-6.0 + (50につき0.001)
    base = c - 6.0 + (s - 800000) / 50 * 0.001;
  }
  
  // 2. ランプ加点（累積）
  let bonus = 0;
  if (isFb) bonus += 0.050;
  
  if (combo === "AB+") bonus += 0.350;
  else if (combo === "AB") bonus += 0.300;
  else if (combo === "FC") bonus += 0.100;
  
  if (rank === "SSS+") bonus += 0.300;
  else if (rank === "SSS") bonus += 0.200;
  else if (rank === "SS") bonus += 0.100;
  
  // 小数第4位以下を切り捨てて第3位までにする
  // (浮動小数点の誤差を防ぐため、1000000倍して丸めてから戻すなどの処理も検討されますが、
  // シンプルに 1000倍 -> floor -> 1000割 で対応します)
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

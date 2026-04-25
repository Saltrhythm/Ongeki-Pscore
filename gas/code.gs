/**
 * ＋は維持しつつ、スペース・記号・全角半角の揺れを吸収するロジック
 */
function doPost(e) {
  try {
    const contents = JSON.parse(e.postData.contents);
    const userName = contents.userName || "Unknown";
    const dataList = contents.scores || []; 
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    const constSheet = ss.getSheetByName('譜面定数表');
    const constValues = constSheet.getDataRange().getValues();
    const constMap = new Map();
    
    // 特定の記号（＋）を守りつつ、他を掃除する関数
    const cleanKey = (str) => {
      if (!str) return "";
      // 1. 全角英数字を半角にする（Ｓ→sなど）
      let s = str.replace(/[！-～]/g, (tmp) => String.fromCharCode(tmp.charCodeAt(0) - 0xFEE0));
      // 2. 「+」以外の記号、スペース、中黒などをすべて削除
      // [^a-zA-Z0-9+...] の部分で「+」を除外対象から外しています
      return s.replace(/[^a-zA-Z0-9+\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, "").toLowerCase();
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

      // 検索キー作成（＋を保持したままクリーンアップ）
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

// calculateTechRating関数はそのまま維持


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
 * キャッシュ対応・高速読み込み版 doGet (新曲枠対応)
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
      // システム用シートや「新曲枠」を一覧から除外
      const list = sheets.map(s => s.getName()).filter(n => 
        !["譜面定数表", "Sheet1", "DebugLog", "新曲枠", "テンプレート"].includes(n)
      );

      try { cache.put(listCacheKey, JSON.stringify(list), 21600); } catch (e) { }
      return createResponse(list);
    }

    // --- 2. 個別データの取得 ---
    // 構造が変わったため、古いキャッシュと混ざらないようキーを変更 (v2)
    const dataCacheKey = "data_v2_" + user;
    const cachedData = cache.get(dataCacheKey);
    if (cachedData) return createResponse(JSON.parse(cachedData));

    // A. ユーザー本人のシートを取得
    const userSheet = ss.getSheetByName(user);
    if (!userSheet) return createResponse({ error: "User sheet not found: " + user });

    // B. 新曲枠のリストを取得（A列の合体キーをSetに格納して高速判定）
    const newSongSheet = ss.getSheetByName("新曲枠");
    let newSongKeys = new Set();
    if (newSongSheet) {
      const newSongValues = newSongSheet.getDataRange().getValues();
      // 1行目(ヘッダー)を飛ばし、A列(index 0)を文字列としてSetに入れる
      newSongValues.slice(1).forEach(row => {
        if (row[0]) newSongKeys.add(String(row[0]).trim());
      });
    }

    // C. メインデータの成形
    const values = userSheet.getDataRange().getValues();
    const data = values.slice(1).map(row => {
      const title = String(row[1] || "").trim();
      const diff = String(row[2] || "").trim();
      const level = String(row[3] || "").trim();
      
      // 新曲枠シートのA列と同じ形式を作成
      const currentKey = title + diff + level;

      return {
        title: title,
        difficulty: diff,
        level: level,
        technicalScore: row[4],    // Tech版で使用
        platinumScore: row[5],     // P版で使用
        platinumMax: row[6],       // P版で使用
        constant: row[7],
        platinumScoreRating: row[8], // P版で使用
        fbLamp: row[9],             // Tech版で使用
        comboLamp: row[10],         // Tech版で使用
        rankLamp: row[11],          // Tech版で使用
        techScoreRating: row[12],   // Tech版で使用
        isNew: newSongKeys.has(currentKey) // ★ここが新曲判定
      };
    });

    const jsonData = JSON.stringify(data);

    // --- キャッシュサイズチェック (100KB制限対策) ---
    if (jsonData.length < 90000) {
      try {
        cache.put(dataCacheKey, jsonData, 1200); // 20分間保存
      } catch (err) {
        console.warn("Cache put failed: " + err.message);
      }
    }

    return createResponse(data);

  } catch (err) {
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

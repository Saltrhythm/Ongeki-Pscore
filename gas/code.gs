/**
 * ブックマークレットからのデータ受信（POST）に対応
 */
function doPost(e) {
  const contents = JSON.parse(e.postData.contents);
  const userName = contents.userName || "Unknown";
  const dataList = contents.scores || []; 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let sheet = ss.getSheetByName(userName);
  if (!sheet) {
    sheet = ss.insertSheet(userName);
    sheet.appendRow(["更新日時", "曲名", "難易度", "レベル", "テクニカル", "Pスコア", "P最大", "定数"]);
  }
  
  // 既存データをMap化して検索を高速化
  const fullData = sheet.getDataRange().getValues();
  const rowMap = new Map();
  for (let i = 1; i < fullData.length; i++) {
    const key = fullData[i][1] + "|" + fullData[i][2]; // 曲名|難易度
    rowMap.set(key, i + 1); // 行番号を保持
  }

  const now = new Date();
  
  // 更新が必要なデータ（個別にsetValueする用）
  const updateQueue = []; 
  // 新規追加するデータの配列（最後に一括appendする用）
  const newRows = [];

  // 現在の最終行を把握（新規追加時の数式用）
  let lastRow = sheet.getLastRow();

  dataList.forEach(data => {
    const key = data.title + "|" + data.difficulty;
    const targetRow = rowMap.get(key);

    if (targetRow) {
      // 既存行は各列をセット（ここも本当は一括化できますが、一旦安全な個別更新で維持）
      sheet.getRange(targetRow, 1, 1, 7).setValues([[
        now, data.title, data.difficulty, data.level,
        data.technicalScore, data.platinumScore, data.platinumMax
      ]]);
    } else {
      // 新規行：メモリ上の配列に追加
      lastRow++;
      const formula = '=IFERROR(VLOOKUP(""&B' + lastRow + '&C' + lastRow + '&D' + lastRow + ', \'譜面定数表\'!$A:$E, 5, FALSE), "まだダメ")';
      newRows.push([
        now, data.title, data.difficulty, data.level,
        data.technicalScore, data.platinumScore, data.platinumMax, formula
      ]);
    }
  });

  // まとめて新規行を追加（ここが爆速ポイント）
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 8).setValues(newRows);
  }

  return ContentService.createTextOutput("Success");
}

/**
 * Webツールからのリクエストに対応
 */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // パラメータがない場合は、有効なユーザー（シート名）一覧を返す
  if (!e.parameter.user) {
    const sheets = ss.getSheets();
    const userList = sheets
      .map(s => s.getName())
      .filter(name => name !== "譜面定数表" && name !== "Sheet1"); // 除外したいシート名を入れる
    
    return ContentService.createTextOutput(JSON.stringify(userList))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // --- 以下、既存の個別データ取得処理 ---
  const userName = e.parameter.user;
  const sheet = ss.getSheetByName(userName);

  // 指定された名前のシートが存在しない場合の処理
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ error: "User not found" }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  const values = sheet.getDataRange().getValues();
  const data = [];
  
  for (let i = 1; i < values.length; i++) {
    const levelStr = String(values[i][3]); // D列: レベルを文字列として取得
    
    // --- 除外条件の判定 ---
    // 1. レベルが "0" である
    // 2. 数値に変換したとき、11未満である（10+ も 10.7 扱い等でなければ 11未満になります）
    const levelNum = parseFloat(levelStr.replace('+', '.7')); // 10+ を 10.7 として計算（判定用）
    
    if (levelStr === "0" || levelNum < 11) {
      continue; // 条件に一致したら、この曲は無視して次のループへ
    }
    
    // 条件をクリアした（11以上の）曲だけを配列に追加
    data.push({
      title: values[i][1],          // B列: 曲名
      difficulty: values[i][2],     // C列: 難易度
      technicalScore: values[i][4], // E列: テクニカル
      platinumScore: values[i][5],  // F列: プラチナ
      platinumMax: values[i][6],    // G列: プラチナ最大
      constant: values[i][7]        // H列: 譜面定数
    });
  }
  
  return ContentService.createTextOutput(JSON.stringify(data))
                       .setMimeType(ContentService.MimeType.JSON);
}

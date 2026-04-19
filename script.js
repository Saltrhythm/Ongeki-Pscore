const GAS_URL = "https://script.google.com/macros/s/AKfycbwAZPIT6MGkDCVti9nz-qJOXSz6vq2RkXoWQLxyWt0pwRUMd1IiWBxuKSFGUyYhfeh3/exec";

let allScores = []; 

/**
 * 起動時に実行
 */
async function initApp() {
    // 1. レベルや定数などの基本フィルタを初期化
    initFilters(); 

    // 2. GASから最新のユーザー一覧（シート名一覧）を取得してセレクトボックスを生成
    await refreshUserList();

    // 3. 最後に選択していたプレイヤー名を復元
    const userSelect = document.getElementById('user-select');
    const savedUser = localStorage.getItem('ongeki_last_user');
    
    // リストの中に保存されていた名前があればセットする
    if (savedUser && userSelect) {
        const options = Array.from(userSelect.options).map(o => o.value);
        if (options.includes(savedUser)) {
            userSelect.value = savedUser;
        }
    }

    // 4. 選択されているユーザーのキャッシュがあれば先に表示する
    const currentUser = userSelect ? userSelect.value : "";
    if (currentUser) {
        const cacheKey = `ongeki_cache_${currentUser}`;
        const cachedData = localStorage.getItem(cacheKey);

        if (cachedData) {
            try {
                allScores = JSON.parse(cachedData);
                displayScores(allScores);
                document.getElementById('loading').style.display = 'none';
            } catch (e) {
                console.error("キャッシュ解析エラー:", e);
            }
        }
    }

    // 5. 最新データをGASから取得して更新
    await loadLatestScores();
}

/**
 * GASからシート名一覧を取得してセレクトボックスを再構築する
 */
async function refreshUserList() {
    const userSelect = document.getElementById('user-select');
    if (!userSelect) return;

    try {
        // パラメータなしでGETリクエストを送り、ユーザー一覧を取得
        const response = await fetch(GAS_URL);
        const userList = await response.json();

        // セレクトボックスの中身をクリアして再構築
        userSelect.innerHTML = '';
        userList.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            userSelect.appendChild(opt);
        });
    } catch (e) {
        console.error("ユーザーリストの取得に失敗しました:", e);
        // 失敗した場合は、手動設定用のデフォルト値を置くかエラー表示
        userSelect.innerHTML = '<option value="">(ユーザー読み込み失敗)</option>';
    }
}

/**
 * GASから最新データを取得
 */
async function loadLatestScores() {
    const userSelect = document.getElementById('user-select');
    const selectedUser = userSelect ? userSelect.value : "Unknown";
    const loadingEl = document.getElementById('loading');

    // 取得開始時に保存しておく
    localStorage.setItem('ongeki_last_user', selectedUser);
    if (loadingEl) loadingEl.style.display = 'block';

    try {
        // GASに対し、?user=名前 の形式でリクエストを送る
        const response = await fetch(`${GAS_URL}?user=${encodeURIComponent(selectedUser)}`);
        const newData = await response.json();
        
        if (newData.error) {
            console.warn("データ未登録:", newData.error);
            allScores = [];
        } else {
            allScores = newData;
            // ユーザーごとのキーでキャッシュを保存
            localStorage.setItem(`ongeki_cache_${selectedUser}`, JSON.stringify(newData));
        }
        
        if (loadingEl) loadingEl.style.display = 'none';
        
        // 最新データで画面を更新
        updateFilters(); 
    } catch (e) {
        console.error("通信エラー:", e);
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

// セレクトボックスが変更された時のイベントリスナーを追加
// (initFilters内で行ってもOKですが、ここにあると確実です)
document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'user-select') {
        loadLatestScores();
    }
});

window.onload = initApp;

/**
 * フィルター（検索窓 + セレクトボックス）の値を読み取って表示を更新する
 */
function updateFilters() {
    const searchInput = document.getElementById('search-input');
    const minSelect = document.getElementById('min-constant');
    const maxSelect = document.getElementById('max-constant');

    if (!searchInput || !minSelect || !maxSelect) return;

    const searchText = searchInput.value.toLowerCase().trim();
    const minConst = parseFloat(minSelect.value);
    const maxConst = parseFloat(maxSelect.value);

    const filteredData = allScores.filter(item => {
        const title = String(item.title || "").toLowerCase();
        // 譜面定数がない場合は、検索にかかるように一時的に大きな値（または表示対象）にするか検討が必要
        // ここでは、定数がない曲は「level」の数値で代用して判定
        const constant = item.constant ? parseFloat(item.constant) : parseFloat(String(item.level).replace('+', '.7'));

        const matchesTitle = title.includes(searchText);
        const matchesConstant = (constant >= minConst && constant <= maxConst);

        return matchesTitle && matchesConstant;
    });

    displayScores(filteredData);
}

/**
 * セレクトボックスの選択肢(11.0〜16.0)を生成
 */
function initFilters() {
    const minSelect = document.getElementById('min-constant');
    const maxSelect = document.getElementById('max-constant');
    const searchInput = document.getElementById('search-input');

    if (!minSelect || !maxSelect) return;

    // 既存のオプションをクリア
    minSelect.innerHTML = "";
    maxSelect.innerHTML = "";

    // 11.0〜16.0の選択肢を生成（1つのループで両方に流し込む）
    for (let i = 110; i <= 160; i++) {
        const val = (i / 10).toFixed(1);
        const opt = `<option value="${val}">${val}</option>`;
        minSelect.insertAdjacentHTML('beforeend', opt);
        maxSelect.insertAdjacentHTML('beforeend', opt); // 上限も同じ昇順にするのが一般的
    }

    // 初期値の設定
    minSelect.value = "11.0";
    maxSelect.value = "16.0";

    // イベントリスナー
    minSelect.addEventListener('change', updateFilters);
    maxSelect.addEventListener('change', updateFilters);
    if (searchInput) {
        searchInput.addEventListener('input', updateFilters);
    }

    // クリアボタン
    const clearBtn = document.getElementById('clear-filter');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            minSelect.value = "11.0";
            maxSelect.value = "16.0";
            if (searchInput) searchInput.value = "";
            updateFilters();
        });
    }
}

/**
 * 画面にスコアを表示する
 */
function displayScores(data) {
    const body = document.getElementById('score-body');
    if (!body) return;
    body.innerHTML = ""; 

    // 達成率が高い順にデータを並び替える
    // platinumScore / platinumMax の計算結果で比較
    data.sort((a, b) => {
        const percentA = (Number(a.platinumMax) > 0) ? (Number(a.platinumScore) / Number(a.platinumMax)) : 0;
        const percentB = (Number(b.platinumMax) > 0) ? (Number(b.platinumScore) / Number(b.platinumMax)) : 0;
        return percentB - percentA; // B - A で降順（高い順）
    });

    const fragment = document.createDocumentFragment();

data.forEach(item => {
    // 1. まず最初に diff を定義する（これが一番上に必要！）
    const diff = String(item.difficulty || "").toUpperCase();
    
    // 2. 次に、BASICやADVANCEDを弾く処理
    if (diff === "BASIC" || diff === "ADVANCED") return;

    // 3. その他の数値を計算する
    const pScore = parseFloat(item.platinumScore) || 0;
    const pMax = parseFloat(item.platinumMax) || 0;
    const pPercentNum = pMax > 0 ? (pScore / pMax) * 100 : 0;
    const pPercentStr = pPercentNum.toFixed(2);

    const isNum = !isNaN(parseFloat(item.constant)) && isFinite(item.constant);
    const displayLevel = isNum ? Number(item.constant).toFixed(1) : (item.level || "-");

    // 4. 星と「次のランクまで」の判定（前回までのロジック）
    let nextGoalPercent = 94;
    let stars = "";
    let starClass = "";

    if (pPercentNum >= 99) {
        stars = "★5"; starClass = "star-rainbow"; nextGoalPercent = 100;
    } else if (pPercentNum >= 98) {
        stars = "★5"; starClass = "star-shine-5"; nextGoalPercent = 99;
    } else if (pPercentNum >= 97) {
        stars = "★4"; starClass = "star-shine-4"; nextGoalPercent = 98;
    } else if (pPercentNum >= 96) {
        stars = "★3"; starClass = "star-shine-3"; nextGoalPercent = 97;
    } else if (pPercentNum >= 95) {
        stars = "★2"; starClass = "star-shine-2"; nextGoalPercent = 96;
    } else if (pPercentNum >= 94) {
        stars = "★1"; starClass = "star-shine-1"; nextGoalPercent = 95;
   } else if (pPercentNum > 0) {
        // ★新設：0%より高いが94%未満の場合
        stars = "★0"; starClass = "star-none"; nextGoalPercent = 94;
    } else {
        // 0%の場合（未プレイ）
        stars = ""; starClass = ""; nextGoalPercent = 94;
    }

    const nextGoalScore = Math.ceil(pMax * (nextGoalPercent / 100));
    const diffToNext = nextGoalScore - pScore;

    let nextText = "";
    let nextClass = "next-val";

    if (pMax <= 0) {
        nextText = "-";
    } else if (pScore <= 0) {
        nextText = `あと ${nextGoalScore}`;
    } else if (pScore >= pMax) {
        nextText = "MAX";
        nextClass += " is-max";
    } else {
        const displayDiff = diffToNext > 0 ? diffToNext : 1;
        nextText = `あと ${displayDiff}`;
    }

    // 5. テーブル行を作成して追加（ここで diff や displayLevel を使う）
    const tr = document.createElement('tr');
    tr.className = diff.toLowerCase();
    tr.innerHTML = `
        <td>
            <div class="title-cell">${item.title || "Unknown"}</div>
            <div class="diff-level-cell">${diff} ${displayLevel}</div>
        </td>

    <td class="p-score-cell">
        <div class="p-values">
            <span class="plat-val">${pScore.toLocaleString()}</span>
            <span class="plat-sub">/ ${pMax.toLocaleString()}</span>
        </div>
    </td>
    <td class="p-percent-cell">
        <span class="p-percent">${pPercentStr}%</span>
        <span class="p-star ${starClass}">${stars ? "(" + stars + ")" : ""}</span>
    </td>
    <td class="p-next-cell">
        <span class="${nextClass}">${nextText}</span>
    </td>
`;
        
        fragment.appendChild(tr);
    });

    body.appendChild(fragment);
}

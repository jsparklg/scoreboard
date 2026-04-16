import React, { useState, useEffect, useRef } from 'react';
import { Trophy, RefreshCcw, RotateCcw, ArrowLeftRight, Settings, Users, ChevronDown, Check, ArrowUpDown, Database, Building, MapPin, Copy, AlertCircle, Plus, Server, Play, Save, Menu, X, Trash2 } from 'lucide-react';

// --- 1. Google Apps Script (GAS) 코드 ---
const gasScript = `// 구글 스프레드시트 배드민턴 DB API (선수 중복방지 및 코트/경기장 분리 버전)
function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var action = params.action;
    var table = params.table;
    var data = params.data;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    function ensureTable(tableName, headers) {
      var s = ss.getSheetByName(tableName);
      if (!s) {
        s = ss.insertSheet(tableName);
        s.appendRow(headers);
      }
      return s;
    }

    ensureTable('clubs', ['club_id', 'name', 'created_at']);
    ensureTable('players', ['player_id', 'name', 'birthdate', 'distinguisher', 'created_at']);
    ensureTable('club_players', ['club_id', 'player_id']);
    ensureTable('venues', ['venue_id', 'name']);
    ensureTable('courts', ['court_id', 'venue_id', 'name']);
    ensureTable('matches', ['match_id', 'club_id', 'venue_name', 'court_name', 'team_a_p1', 'team_a_p2', 'team_b_p1', 'team_b_p2', 'team_a_sets', 'team_b_sets', 'winner', 'status', 'started_at', 'ended_at']);
    ensureTable('match_logs', ['log_id', 'match_id', 'team_a_score', 'team_b_score', 'scoring_team', 'server_player_id', 'recorded_at']);

    var result = {};

    if (action === 'read') {
      var sheet = ss.getSheetByName(table);
      var rows = sheet.getDataRange().getValues();
      var resultData = [];
      if (rows.length > 1) {
        var headers = rows[0];
        for(var i=1; i<rows.length; i++) {
          var obj = {};
          for(var j=0; j<headers.length; j++) {
            obj[headers[j]] = rows[i][j];
          }
          resultData.push(obj);
        }
      }
      result.data = resultData;
    }
    else if (action === 'read_club_players') {
      var cpRows = ss.getSheetByName('club_players').getDataRange().getValues();
      var pRows = ss.getSheetByName('players').getDataRange().getValues();
      
      var playerIds = [];
      for(var i=1; i<cpRows.length; i++) {
        if(String(cpRows[i][0]) === String(data.club_id)) playerIds.push(String(cpRows[i][1]));
      }
      
      var resultData = [];
      if(pRows.length > 1) {
        var pHeaders = pRows[0];
        for(var i=1; i<pRows.length; i++) {
          if(playerIds.indexOf(String(pRows[i][0])) !== -1) {
            var obj = {};
            for(var j=0; j<pHeaders.length; j++) obj[pHeaders[j]] = pRows[i][j];
            resultData.push(obj);
          }
        }
      }
      result.data = resultData;
    }
    else if (action === 'insert') {
       var sheet = ss.getSheetByName(table);
       var id = sheet.getLastRow(); 
       var timestamp = new Date().toISOString();
       if(table === 'clubs') sheet.appendRow([id, data.name, timestamp]);
       if(table === 'venues') sheet.appendRow([id, data.name]);
       if(table === 'courts') sheet.appendRow([id, data.venue_id, data.name]);
       SpreadsheetApp.flush();
       result = { success: true, id: id };
    }
    else if (action === 'insert_player') {
       var pSheet = ss.getSheetByName('players');
       var pRows = pSheet.getDataRange().getValues();
       var existingPlayerId = null;
       
       var name = (data.name || '').toString().trim();
       var birth = (data.birthdate || '').toString().trim();
       var dist = (data.distinguisher || '').toString().trim();

       for(var i=1; i<pRows.length; i++) {
           if((pRows[i][1] || '').toString().trim() === name && 
              (pRows[i][2] || '').toString().trim() === birth && 
              (pRows[i][3] || '').toString().trim() === dist) {
               existingPlayerId = pRows[i][0];
               break;
           }
       }
       
       if(!existingPlayerId) {
           existingPlayerId = pSheet.getLastRow(); 
           pSheet.appendRow([existingPlayerId, name, birth, dist, new Date().toISOString()]);
       }
       
       var cpSheet = ss.getSheetByName('club_players');
       var cpRows = cpSheet.getDataRange().getValues();
       var alreadyLinked = false;
       for(var j=1; j<cpRows.length; j++) {
           if(String(cpRows[j][0]) === String(data.club_id) && String(cpRows[j][1]) === String(existingPlayerId)) {
               alreadyLinked = true;
               break;
           }
       }
       
       if(!alreadyLinked) {
           cpSheet.appendRow([data.club_id, existingPlayerId]);
       }
       SpreadsheetApp.flush();
       result = { success: true, player_id: existingPlayerId, is_new: !existingPlayerId };
    }
    else if (action === 'delete_club_player') {
       var cpSheet = ss.getSheetByName('club_players');
       var cpRows = cpSheet.getDataRange().getValues();
       for(var i=1; i<cpRows.length; i++) {
          if(String(cpRows[i][0]) === String(data.club_id) && String(cpRows[i][1]) === String(data.player_id)) {
             cpSheet.deleteRow(i+1);
             break;
          }
       }
       SpreadsheetApp.flush();
       result = { success: true };
    }
    else if (action === 'delete') {
       var sheet = ss.getSheetByName(table);
       var rows = sheet.getDataRange().getValues();
       var idField = table === 'venues' ? 'venue_id' : 'court_id';
       var idIdx = rows[0].indexOf(idField);
       for(var i=1; i<rows.length; i++) {
          if(String(rows[i][idIdx]) === String(data.id)) {
             sheet.deleteRow(i+1);
             break;
          }
       }
       SpreadsheetApp.flush();
       result = { success: true };
    }
    else if (action === 'save_match_full') {
       var matchSheet = ss.getSheetByName('matches');
       var logSheet = ss.getSheetByName('match_logs');
       var matchId = matchSheet.getLastRow();
       var m = data.match;
       
       matchSheet.appendRow([
         matchId, m.club_id || '', m.venue_name || '', m.court_name || '',
         m.team_a_p1 || '', m.team_a_p2 || '', m.team_b_p1 || '', m.team_b_p2 || '',
         m.team_a_sets || 0, m.team_b_sets || 0, m.winner || '', 'completed',
         m.started_at || '', new Date().toISOString()
       ]);

       var logs = data.logs;
       if (logs && logs.length > 0) {
         var startLogId = logSheet.getLastRow();
         var logRows = [];
         for (var i = 0; i < logs.length; i++) {
           logRows.push([
             startLogId + i, matchId, logs[i].team_a_score || 0, logs[i].team_b_score || 0,
             logs[i].scoring_team || '', logs[i].server_player_id || '', logs[i].recorded_at || new Date().toISOString()
           ]);
         }
         logSheet.getRange(logSheet.getLastRow() + 1, 1, logRows.length, logRows[0].length).setValues(logRows);
       }
       SpreadsheetApp.flush();
       result = { success: true };
    }

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({error: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}`;

const App = () => {
  // --- State Definitions ---
  const [matchConfig, setMatchConfig] = useState({ pointsToWin: 25, setsToWin: 1, deuceRule: '2-point' });
  const [teams, setTeams] = useState({
    club_id: null, venue_name: '', court_name: '',
    left: { id: 'A', name: 'Team A', p1: 'Player 1', p2: 'Player 2', p1_id: null, p2_id: null },
    right: { id: 'B', name: 'Team B', p1: 'Player 3', p2: 'Player 4', p1_id: null, p2_id: null }
  });
  const [positions, setPositions] = useState({ left: { top: 'p1', bottom: 'p2' }, right: { top: 'p1', bottom: 'p2' } });
  const [scores, setScores] = useState({ left: 0, right: 0 });
  const [sets, setSets] = useState({ left: 0, right: 0 });
  const [server, setServer] = useState('left'); 
  const [gameHistory, setGameHistory] = useState([]); 
  const [matchLogs, setMatchLogs] = useState([]); 
  const [isMatchOver, setIsMatchOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [isDeuce, setIsDeuce] = useState(false);
  
  // App Modes
  const [isMatchStarted, setIsMatchStarted] = useState(false); 
  const [isDbMatch, setIsDbMatch] = useState(false);
  
  // UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isEditNamesOpen, setIsEditNamesOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [localRoster, setLocalRoster] = useState(["Player 1", "Player 2", "Player 3", "Player 4", "홍길동", "이순신", "강감찬"]);
  const [newLocalPlayer, setNewLocalPlayer] = useState("");

  // DB & Management State
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [adminTab, setAdminTab] = useState('connect'); 
  
  // 🌟 새롭게 추가할 심판 시점 상태 (동서남북 4방향)
  const [umpirePos, setUmpirePos] = useState('E'); 
  const umpirePosLabels = { 'E': '좌A팀우B팀', 'S': 'A팀 코트 뒤', 'W': '좌B팀우A팀', 'N': 'B팀 코트 뒤' };
  const handleUmpirePosChange = () => {
    const posMap = { 'E': 'S', 'S': 'W', 'W': 'N', 'N': 'E' };
    setUmpirePos(posMap[umpirePos]);
  };

  const [gasUrl, setGasUrl] = useState(() => localStorage.getItem('badminton_gas_url') || '');
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); 

// 🌟 기존 코드를 아래 내용으로 교체하세요
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      const saved = localStorage.getItem('badminton_bookmarks');
      const parsed = saved ? JSON.parse(saved) : [];
      
      // 저장된 북마크가 하나도 없을 때만 아래 4개의 디폴트 값을 사용합니다.
      if (parsed.length === 0) {
        return [
          { name: '노블디자인', url: 'https://script.google.com/macros/s/AKfycbx01w3JKcelJEjtVOYsklKiWyVKj6ttzjul-MSmZ_clmm8uHHLzkXwIGqnGeEz7k1Uh/exec' },
          { name: '다원클럽', url: 'https://script.google.com/macros/s/AKfycby4p72lpJcz97CZ7oVZooCR3DRx_6OIMbf0tRzbAF0Gz940QX3J88hwsqfEI9eWGd9ZnQ/exec' },
          { name: '동탄시온', url: 'https://script.google.com/macros/s/AKfycbwGep1jYe0TxXRIxvcP6GfWrcyVCEr6NccYddsxbjC4OGuDWr39FwjY9n-JSyk5RXcI/exec' },
          { name: '기흥클럽', url: 'https://script.google.com/macros/s/AKfycbzbt1e-vEZbjotpe8oH-8zUDwdu_uVTmwQ9d6F84SJQEBRoVTmkoh5dBDkGR0KQnO3B/exec' }
        ];
      }
      return parsed;
    } catch { return []; }
  });

  const [bookmarkName, setBookmarkName] = useState('');
  useEffect(() => {
    localStorage.setItem('badminton_bookmarks', JSON.stringify(bookmarks));
    localStorage.setItem('badminton_gas_url', gasUrl); // 기존 URL 저장 유지
  }, [bookmarks, gasUrl]);

  const handleSaveBookmark = () => {
    if (!gasUrl || !bookmarkName) return alert('URL과 북마크 이름을 모두 입력해주세요.');
    const newBookmarks = [...bookmarks.filter(b => b.url !== gasUrl), { name: bookmarkName, url: gasUrl }];
    setBookmarks(newBookmarks);
    setBookmarkName('');
    alert('북마크가 저장되었습니다!');
  };

  const handleDeleteBookmark = (url) => {
    if(window.confirm('이 북마크를 삭제하시겠습니까?')) {
      setBookmarks(bookmarks.filter(b => b.url !== url));
    }
  };
  const [isSaving, setIsSaving] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); 
  const [copied, setCopied] = useState(false);

  const [clubs, setClubs] = useState([]);
  const [venues, setVenues] = useState([]);
  const [courts, setCourts] = useState([]);
  const [players, setPlayers] = useState([]);
  
  // Inputs
  const [newClubName, setNewClubName] = useState('');
  const [newVenueName, setNewVenueName] = useState('');
  const [newCourtName, setNewCourtName] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerBirthdate, setNewPlayerBirthdate] = useState('');
  const [newPlayerDistinguisher, setNewPlayerDistinguisher] = useState('');
  const [selectedClubId, setSelectedClubId] = useState('');

  // Dropdowns
  const [manageSelectedVenue, setManageSelectedVenue] = useState('');
  const [manageSelectedCourt, setManageSelectedCourt] = useState('');
  const [manageSelectedPlayer, setManageSelectedPlayer] = useState('');

  // Match Setup State
  const [playVenueId, setPlayVenueId] = useState('');
  const [playCourtId, setPlayCourtId] = useState('');
  const [playTeamA, setPlayTeamA] = useState({ name: 'Team A', p1: '', p2: '' });
  const [playTeamB, setPlayTeamB] = useState({ name: 'Team B', p1: '', p2: '' });

  // Refs
  const startedAt = useRef(new Date().toISOString());
  const logEndRef = useRef(null);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [scores]);

  // --- DB Fetch Functions ---
  const fetchGasAPI = async (payload) => {
    try {
      const res = await fetch(gasUrl, { 
        method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' 
      });
      const text = await res.text();
      let json = JSON.parse(text);
      if (json.error) throw new Error(json.error);
      if (payload.action !== 'read' && payload.action !== 'read_club_players' && !json.success) {
        throw new Error("처리 실패: Apps Script 코드가 구버전일 수 있습니다. '새 버전으로 배포'를 확인해주세요.");
      }
      return json;
    } catch (e) {
      throw new Error(e.message || "서버 응답 오류");
    }
  };

// 🌟 새롭게 추가된 정렬 도우미 함수 (한글 가나다, 영문 ABC 순서로 정렬)
  const sortByName = (arr) => {
    return [...arr].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR'));
  };

  const handleConnect = async () => {
    if (!gasUrl.includes('script.google.com/macros')) return alert('올바른 Google Apps Script URL을 입력해주세요.');
    setConnectionStatus('connecting');
    try {
      const resClubs = await fetchGasAPI({ action: 'read', table: 'clubs' });
      const resVenues = await fetchGasAPI({ action: 'read', table: 'venues' });
      const resCourts = await fetchGasAPI({ action: 'read', table: 'courts' });
      
      // 불러온 데이터를 가나다순으로 정렬하여 저장
      setClubs(sortByName(resClubs.data));
      setVenues(sortByName(resVenues.data));
      setCourts(sortByName(resCourts.data));
      setConnectionStatus('connected');
      setAdminTab('manage');
    } catch (error) {
      setConnectionStatus('error'); alert('연결 실패: ' + error.message);
    }
  };

  const loadClubPlayers = async () => {
    if (!gasUrl || !selectedClubId) return;
    try {
      const pRes = await fetchGasAPI({ action: 'read_club_players', data: { club_id: selectedClubId } });
      // 선수 목록도 가나다순으로 정렬하여 저장
      setPlayers(sortByName(pRes.data));
    } catch (e) { console.error(e); }
  };

  useEffect(() => { if (selectedClubId) loadClubPlayers(); }, [selectedClubId]);

  const handleAddClub = async () => {
    if (!newClubName.trim()) return alert('클럽 이름을 입력해주세요.');
    setIsProcessing(true);
    try { await fetchGasAPI({ action: 'insert', table: 'clubs', data: { name: newClubName } }); setNewClubName(''); handleConnect(); } 
    catch (e) { alert(e); } finally { setIsProcessing(false); }
  };

  const handleAddVenue = async () => {
    if (!newVenueName.trim()) return alert('경기장 이름을 입력해주세요.');
    setIsProcessing(true);
    try { 
      await fetchGasAPI({ action: 'insert', table: 'venues', data: { name: newVenueName } }); 
      setNewVenueName(''); 
      const res = await fetchGasAPI({ action: 'read', table: 'venues' }); 
      setVenues(sortByName(res.data)); // 추가 후 다시 정렬
    } catch (e) { alert(e); } finally { setIsProcessing(false); }
  };

  const handleAddCourt = async () => {
    if (!manageSelectedVenue) return alert('코트를 추가할 경기장을 선택해주세요.');
    if (!newCourtName.trim()) return alert('코트 이름을 입력해주세요.');
    setIsProcessing(true);
    try { 
      await fetchGasAPI({ action: 'insert', table: 'courts', data: { venue_id: manageSelectedVenue, name: newCourtName } }); 
      setNewCourtName(''); 
      const res = await fetchGasAPI({ action: 'read', table: 'courts' }); 
      setCourts(sortByName(res.data)); // 추가 후 다시 정렬
    } catch (e) { alert(e); } finally { setIsProcessing(false); }
  };

  const handleDeleteCourt = async () => {
    if (!manageSelectedCourt) return alert('삭제할 코트를 선택해주세요.');
    if (!window.confirm('코트를 삭제하시겠습니까?')) return;
    setIsProcessing(true);
    try { 
      await fetchGasAPI({ action: 'delete', table: 'courts', data: { id: manageSelectedCourt } }); 
      setManageSelectedCourt('');
      const res = await fetchGasAPI({ action: 'read', table: 'courts' }); 
      setCourts(sortByName(res.data)); // 삭제 후 다시 정렬
    } catch (e) { alert(e); } finally { setIsProcessing(false); }
  };

  const handleAddPlayer = async () => {
    if (!newPlayerName.trim()) return alert('선수 이름을 입력해주세요.');
    setIsProcessing(true);
    try { 
      await fetchGasAPI({ 
        action: 'insert_player', 
        data: { club_id: selectedClubId, name: newPlayerName, birthdate: newPlayerBirthdate, distinguisher: newPlayerDistinguisher } 
      }); 
      setNewPlayerName(''); setNewPlayerBirthdate(''); setNewPlayerDistinguisher(''); 
      await loadClubPlayers(); 
    } catch (e) { alert(e); } finally { setIsProcessing(false); }
  };

  const handleDeletePlayer = async () => {
    if (!manageSelectedPlayer) return alert('클럽에서 제외할 선수를 선택해주세요.');
    if (!window.confirm('이 선수를 해당 클럽 명단에서 제외하시겠습니까?')) return;
    setIsProcessing(true);
    try { 
      await fetchGasAPI({ action: 'delete_club_player', data: { club_id: selectedClubId, player_id: manageSelectedPlayer } }); 
      setManageSelectedPlayer(''); await loadClubPlayers(); 
    } catch (e) { alert(e); } finally { setIsProcessing(false); }
  };

  const handleCopyScript = () => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = gasScript;
      textArea.style.top = "0"; textArea.style.left = "0"; textArea.style.position = "fixed";
      document.body.appendChild(textArea);
      textArea.focus(); textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true); setTimeout(() => setCopied(false), 2000); 
    } catch (err) { alert('복사 실패. 수동으로 복사해주세요.'); }
  };

  // --- Helpers ---
  const formatPlayerDisplay = (p) => {
    if (!p) return 'Unknown';
    let parts = [p.name];
    if (p.birthdate) parts.push(`(${p.birthdate})`);
    if (p.distinguisher) parts.push(`[${p.distinguisher}]`);
    return parts.join(' ');
  };

  const getAcronym = (name) => {
    if (!name) return '';
    let displayName = name.replace(/\s*\([^)]*\)/g, '').trim();
    displayName = displayName.replace(/\s*\[[^\]]*\]/g, '').trim(); 
    const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(displayName);
    if (isKorean) return displayName;
    if (!displayName.includes(' ')) return displayName;
    return displayName.split(' ').map(part => part[0]).join('').toUpperCase().substring(0, 3);
  };

  const handleAddLocalPlayer = () => {
    const trimmed = newLocalPlayer.trim();
    if (trimmed && !localRoster.includes(trimmed)) {
      setLocalRoster([...localRoster, trimmed]);
      setNewLocalPlayer("");
    }
  };

  // --- Logic ---
  const handleStartDbMatch = () => {
    if (!playVenueId || !playCourtId || !playTeamA.p1 || !playTeamA.p2 || !playTeamB.p1 || !playTeamB.p2) {
      return alert('경기장, 코트 및 4명의 선수를 모두 선택해주세요.');
    }
    const getP = (id) => formatPlayerDisplay(players.find(p => String(p.player_id) === String(id)));
    const venueName = venues.find(v => String(v.venue_id) === String(playVenueId))?.name || '';
    const courtName = courts.find(c => String(c.court_id) === String(playCourtId))?.name || '';

    setTeams({
      club_id: selectedClubId,
      venue_name: venueName,
      court_name: courtName,
      left: { id: 'A', name: playTeamA.name || 'Team A', p1: getP(playTeamA.p1), p2: getP(playTeamA.p2), p1_id: playTeamA.p1, p2_id: playTeamA.p2 },
      right: { id: 'B', name: playTeamB.name || 'Team B', p1: getP(playTeamB.p1), p2: getP(playTeamB.p2), p1_id: playTeamB.p1, p2_id: playTeamB.p2 }
    });
    setIsDbMatch(true);
    executeReset(true);
    setIsMenuOpen(false);
  };

  const pushHistory = () => {
    setGameHistory(prev => [...prev, { scores: { ...scores }, sets: { ...sets }, server, positions: JSON.parse(JSON.stringify(positions)), isMatchOver, winner, isDeuce, isMatchStarted }]);
  };

  const undo = () => {
    if (gameHistory.length === 0) return;
    const lastState = gameHistory[gameHistory.length - 1];
    setScores(lastState.scores); setSets(lastState.sets); setServer(lastState.server);
    setPositions(lastState.positions); setIsMatchOver(lastState.isMatchOver);
    setWinner(lastState.winner); setIsDeuce(lastState.isDeuce);
    if (gameHistory.length === 1) setIsMatchStarted(false);
    setGameHistory(prev => prev.slice(0, -1));
    setMatchLogs(prev => prev.slice(0, -1));
  };

  const executeReset = (keepDbState = false) => {
    setScores({ left: 0, right: 0 }); setSets({ left: 0, right: 0 }); setServer('left'); 
    setPositions({ left: { top: 'p1', bottom: 'p2' }, right: { top: 'p1', bottom: 'p2' } });
    setGameHistory([]); setMatchLogs([]); setIsMatchOver(false); setWinner(null);
    setIsDeuce(false); setIsMatchStarted(false); setIsResetConfirmOpen(false);
    if (!keepDbState) setIsDbMatch(false);
    startedAt.current = new Date().toISOString();
  };

  const swapSides = () => {
    setTeams(prev => ({ ...prev, left: prev.right, right: prev.left }));
    setScores({ left: scores.right, right: scores.left });
    setSets({ left: sets.right, right: sets.left });
    setServer(server === 'left' ? 'right' : 'left');
    setPositions({ left: { top: positions.right.bottom, bottom: positions.right.top }, right: { top: positions.left.bottom, bottom: positions.left.top } }); 
    setGameHistory(prev => prev.map(h => ({
      ...h,
      scores: { left: h.scores.right, right: h.scores.left }, sets: { left: h.sets.right, right: h.sets.left },
      server: h.server === 'left' ? 'right' : 'left',
      positions: { left: { top: h.positions.right.bottom, bottom: h.positions.right.top }, right: { top: h.positions.left.bottom, bottom: h.positions.left.top } }
    }))); 
  };

  const handleScore = (side) => {
    if (isMatchOver) return;

    pushHistory();
    const opponent = side === 'left' ? 'right' : 'left';
    
    const servingScore = scores[server];
    const isEven = servingScore % 2 === 0;
    const activeBox = server === 'left' ? (isEven ? 'bottom' : 'top') : (isEven ? 'top' : 'bottom');
    const serverPlayerKey = positions[server][activeBox]; 
    const serverPlayerId = teams[server][`${serverPlayerKey}_id`];

    const isServerWon = server === side;
    setServer(side);

    if (isServerWon) {
      setPositions(prev => ({ ...prev, [side]: { top: prev[side].bottom, bottom: prev[side].top } }));
    }

    const newScore = parseInt(scores[side]) + 1;
    const opponentScore = parseInt(scores[opponent]);
    const targetPoint = parseInt(matchConfig.pointsToWin);
    const capPoint = targetPoint + 5; 
    
    let roundWon = false;
    if (matchConfig.deuceRule === '1-point') { if (newScore >= targetPoint) roundWon = true; } 
    else { if (newScore >= capPoint) roundWon = true; else if (newScore >= targetPoint && (newScore - opponentScore) >= 2) roundWon = true; }
    
    setIsDeuce(matchConfig.deuceRule === '2-point' && (newScore >= targetPoint - 1) && (opponentScore >= targetPoint - 1) && !roundWon);
    setScores({ ...scores, [side]: newScore });

    if (isDbMatch) {
      const isScorerTeamA = teams[side].id === 'A';
      const teamAScore = isScorerTeamA ? newScore : (teams.left.id === 'A' ? scores.left : scores.right);
      const teamBScore = !isScorerTeamA ? newScore : (teams.left.id === 'B' ? scores.left : scores.right);
      
      setMatchLogs(prev => [...prev, {
        team_a_score: teamAScore, team_b_score: teamBScore,
        scoring_team: teams[side].id, server_player_id: serverPlayerId, recorded_at: new Date().toISOString()
      }]);
    }

    if (roundWon) {
      const newSets = { ...sets, [side]: sets[side] + 1 };
      setSets(newSets);
      if (newSets[side] >= matchConfig.setsToWin) { setIsMatchOver(true); setWinner(side); } 
      else { setTimeout(() => { setScores({ left: 0, right: 0 }); setIsDeuce(false); setServer(side); setIsMatchStarted(false); }, 2000); }
    }
  };

  const saveResultsToDB = async () => {
    const matchData = {
      club_id: teams.club_id,
      venue_name: teams.venue_name,
      court_name: teams.court_name,
      team_a_p1: teams.left.id === 'A' ? teams.left.p1_id : teams.right.p1_id,
      team_a_p2: teams.left.id === 'A' ? teams.left.p2_id : teams.right.p2_id,
      team_b_p1: teams.left.id === 'B' ? teams.left.p1_id : teams.right.p1_id,
      team_b_p2: teams.left.id === 'B' ? teams.left.p2_id : teams.right.p2_id,
      team_a_sets: teams.left.id === 'A' ? sets.left : sets.right,
      team_b_sets: teams.left.id === 'B' ? sets.left : sets.right,
      winner: winner === 'left' ? teams.left.id : teams.right.id,
      started_at: startedAt.current
    };
    
    setIsSaving(true);
    try {
      await fetchGasAPI({ action: 'save_match_full', data: { match: matchData, logs: matchLogs } });
      alert('데이터베이스에 경기 결과가 성공적으로 저장되었습니다!');
      executeReset(true);
    } catch (e) { alert('저장 실패: ' + e.message); } finally { setIsSaving(false); }
  };

// --- Components ---
  const CourtSide = ({ side, score, isServing, teamData, teamPositions, onSwapPlayers, umpirePos }) => {
    const isEven = score % 2 === 0;
    let activeBox = null;
    if (isServing) activeBox = side === 'left' ? (isEven ? 'bottom' : 'top') : (isEven ? 'top' : 'bottom');
    
    const isVerticalNet = umpirePos === 'E' || umpirePos === 'W';

    // 🌟 버그 픽스: S(A팀 뒤)와 N(B팀 뒤) 뷰에서 반대편 코트의 짝/홀수 좌우가 뒤집히던 문제 해결
    let courtFlex = ''; let p1Border = ''; let settingFlex = '';
    if (umpirePos === 'E') { courtFlex = 'flex-col'; p1Border = 'border-b'; settingFlex = 'flex-col'; }
    else if (umpirePos === 'W') { courtFlex = 'flex-col-reverse'; p1Border = 'border-t'; settingFlex = 'flex-col-reverse'; }
    else if (umpirePos === 'S') { courtFlex = 'flex-row'; p1Border = 'border-r'; settingFlex = 'flex-row'; }
    else if (umpirePos === 'N') { courtFlex = 'flex-row-reverse'; p1Border = 'border-l'; settingFlex = 'flex-row-reverse'; }

    return (
      <div 
        className={`flex-1 relative flex ${courtFlex} border-white/40 h-full cursor-pointer group active:scale-[0.99] transition-all duration-300 overflow-hidden ${!isMatchStarted && isServing ? 'border-yellow-400 ring-4 ring-yellow-400/50 z-10 shadow-2xl shadow-yellow-500/20' : ''}`}
        onClick={() => { !isMatchStarted ? setServer(side) : handleScore(side); }}
      >
        {isMatchStarted && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 overflow-hidden p-2">
            <span 
              className="font-black text-red-500/70 select-none tracking-tighter drop-shadow-[0_8px_16px_rgba(220,38,38,0.6)] leading-none transition-all duration-300"
              style={{ fontSize: score > 9 ? 'clamp(10rem, min(35vw, 35vh), 24rem)' : 'clamp(12rem, min(45vw, 45vh), 30rem)' }}
            >
              {score}
            </span>
          </div>
        )}

        <div className="absolute inset-0 bg-black/0 group-hover:bg-white/5 transition-colors z-30 flex items-center justify-center pointer-events-none">
          {isMatchStarted ? (
            <span className="opacity-0 group-hover:opacity-100 bg-black/50 text-white px-3 py-1 rounded-full text-sm backdrop-blur-sm transform translate-y-4 group-hover:translate-y-0 transition-all">+1 Point</span>
          ) : (
            <span className="opacity-0 group-hover:opacity-100 bg-blue-500/80 text-white px-3 py-1 rounded-full text-sm backdrop-blur-sm transform translate-y-4 group-hover:translate-y-0 transition-all font-bold">서브팀으로 선택</span>
          )}
        </div>

        <div className={`flex-1 ${p1Border} border-white/20 relative flex items-center justify-center z-20 ${activeBox === 'top' ? 'bg-yellow-400/30' : ''} ${!isMatchStarted ? 'hover:bg-white/10 transition-colors' : ''}`} onClick={(e) => { if (!isMatchStarted) { e.stopPropagation(); onSwapPlayers(side); } }}>
           {activeBox === 'top' && <div className="absolute inset-0 animate-pulse bg-yellow-400/20 pointer-events-none" />}
           <span className={`text-white/90 font-bold select-none transform rotate-0 pointer-events-none drop-shadow-md ${isVerticalNet ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl'}`}>{getAcronym(teamData[teamPositions.top])}</span>
        </div>

        <div className={`flex-1 relative flex items-center justify-center z-20 ${activeBox === 'bottom' ? 'bg-yellow-400/30' : ''} ${!isMatchStarted ? 'hover:bg-white/10 transition-colors' : ''}`} onClick={(e) => { if (!isMatchStarted) { e.stopPropagation(); onSwapPlayers(side); } }}>
           {activeBox === 'bottom' && <div className="absolute inset-0 animate-pulse bg-yellow-400/20 pointer-events-none" />}
           <span className={`text-white/90 font-bold select-none transform rotate-0 pointer-events-none drop-shadow-md ${isVerticalNet ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl'}`}>{getAcronym(teamData[teamPositions.bottom])}</span>
        </div>

        {!isMatchStarted && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40 animate-in fade-in duration-300">
            <div className="bg-gray-900/80 backdrop-blur-md text-white px-3 py-2 sm:px-4 sm:py-3 rounded-xl shadow-lg flex flex-col items-center min-w-[100px] pointer-events-auto cursor-default" onClick={(e) => e.stopPropagation()}>
              <span className="text-[10px] sm:text-xs text-gray-300 uppercase tracking-wider mb-2">{teamData.name}</span>
              <div className={`flex ${settingFlex} gap-2 text-sm sm:text-lg font-bold items-center rounded-lg transition-colors cursor-pointer bg-white/10 px-2 py-1 sm:px-3 hover:bg-white/20`} onClick={(e) => { e.stopPropagation(); onSwapPlayers(side); }}>
                 <span>{getAcronym(teamData[teamPositions.top])}</span>
                 <ArrowUpDown size={14} className={`text-gray-400 ${!isVerticalNet ? 'rotate-90' : ''}`} />
                 <span>{getAcronym(teamData[teamPositions.bottom])}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

// 🌟 항목이 하나일 때 자동(Default) 선택 로직
  useEffect(() => { 
    if (clubs.length === 1 && !selectedClubId) setSelectedClubId(String(clubs[0].club_id)); 
  }, [clubs, selectedClubId]);

  useEffect(() => {
    if (venues.length === 1) {
      if (!manageSelectedVenue) setManageSelectedVenue(String(venues[0].venue_id));
      if (!playVenueId) setPlayVenueId(String(venues[0].venue_id));
    }
  }, [venues, manageSelectedVenue, playVenueId]);

  useEffect(() => {
    if (playVenueId) {
      const filtered = courts.filter(c => String(c.venue_id) === String(playVenueId));
      if (filtered.length === 1 && !playCourtId) setPlayCourtId(String(filtered[0].court_id));
    }
  }, [courts, playVenueId, playCourtId]);


// --- 🌟 새롭게 추가: 모달창 드래그(이동) 제어 로직 ---
  const [modalPos, setModalPos] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = (e) => {
    // 🌟 버튼, 입력창, 또는 버튼 내부의 아이콘 등을 클릭했을 때는 드래그를 시작하지 않습니다.
    if (
      e.target.tagName === 'BUTTON' || 
      e.target.tagName === 'INPUT' || 
      e.target.closest('button') ||
      e.target.closest('input')
    ) return;

    setIsDragging(true);
    setDragOffset({ x: e.clientX - modalPos.x, y: e.clientY - modalPos.y });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    setModalPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
  };

  const handlePointerUp = (e) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  // --------------------------------------------------

  const fullLog = [...gameHistory, { scores, sets, server, positions, isMatchOver, winner, isDeuce, isMatchStarted }];
  let displayLog = [];
  for (let i = fullLog.length - 1; i >= 0; i--) {
    displayLog.unshift(fullLog[i]);
    if (fullLog[i].scores.left === 0 && fullLog[i].scores.right === 0) break;
  }

// --- 🌟 새롭게 추가: 다음 경기 대기열(Queue) 로직 ---
  const [nextMatch, setNextMatch] = useState(null);

  const handleQueueNextMatch = () => {
    if (!playVenueId || !playCourtId) return alert('경기장과 코트를 선택해주세요.');
    if (!playTeamA.name || !playTeamB.name) return alert('양 팀의 이름을 입력해주세요.');
    if (!playTeamA.p1 || !playTeamA.p2 || !playTeamB.p1 || !playTeamB.p2) return alert('양 팀의 선수를 모두 선택해주세요.');

    const getPName = (id) => {
      const p = players.find(p => String(p.player_id) === String(id));
      return p ? formatPlayerDisplay(p) : 'Unknown';
    };
    
    const venueName = venues.find(v => String(v.venue_id) === String(playVenueId))?.name || '';
    const courtName = courts.find(c => String(c.court_id) === String(playCourtId))?.name || '';

    setNextMatch({
      club_id: selectedClubId,
      venue_name: venueName,
      court_name: courtName,
      left: { id: 'A', name: playTeamA.name, p1: getPName(playTeamA.p1), p2: getPName(playTeamA.p2), p1_id: playTeamA.p1, p2_id: playTeamA.p2 },
      right: { id: 'B', name: playTeamB.name, p1: getPName(playTeamB.p1), p2: getPName(playTeamB.p2), p1_id: playTeamB.p1, p2_id: playTeamB.p2 }
    });
    alert('다음 경기가 대기열에 등록되었습니다! 현재 경기가 끝나면 불러올 수 있습니다.');
  };

  const handleLoadNextMatch = () => {
    setTeams({
      club_id: nextMatch.club_id,
      venue_name: nextMatch.venue_name,
      court_name: nextMatch.court_name,
      left: { ...nextMatch.left },
      right: { ...nextMatch.right }
    });
    setIsDbMatch(true);
    // 🌟 핵심 수정: 개별 상태를 일일이 변경하다가 꼬이는 현상(먹통)을 방지하기 위해, 
    // 검증된 시스템 초기화 함수인 executeReset(true)로 완벽하게 일괄 동기화합니다!
    executeReset(true); 
    setNextMatch(null); 
  };
  // --------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col text-white font-sans overflow-hidden">

{/* 1. 상단 스코어보드 헤더 (메뉴 버튼 제거로 순수 점수판 집중) */}
      <header className="bg-slate-800 shadow-lg z-20 px-4 py-3 sm:py-4 shrink-0">
        <div className="max-w-4xl mx-auto flex flex-col gap-2 sm:gap-4">
          <div className="flex justify-between items-center">
            {/* Left Score */}
            <div className="flex items-center gap-3 sm:gap-4">
               <div className={`w-14 h-14 sm:w-24 sm:h-24 rounded-xl sm:rounded-2xl flex items-center justify-center text-4xl sm:text-6xl font-bold tabular-nums shadow-inner transition-colors duration-300 ${winner === 'left' ? 'bg-yellow-500 text-black scale-105' : 'bg-black/40 text-blue-400'}`}>{scores.left}</div>
               <div>
                 <div className="text-lg sm:text-2xl font-bold text-blue-400">{teams.left.name}</div>
                 <div className="text-[10px] sm:text-sm text-gray-400 flex gap-1.5 sm:gap-2"><span>{teams.left.p1}</span>•<span>{teams.left.p2}</span></div>
               </div>
            </div>

            {/* Set Info */}
            <div className="flex flex-col items-center gap-0.5 sm:gap-1">
               <div className="text-[9px] sm:text-xs font-mono text-gray-400 tracking-tighter sm:tracking-normal">SETS</div>
               <div className="flex gap-2 sm:gap-4 text-xl sm:text-2xl font-bold">
                  <span className={sets.left > sets.right ? 'text-blue-400' : 'text-gray-500'}>{sets.left}</span>
                  <span className="text-gray-600">:</span>
                  <span className={sets.right > sets.left ? 'text-red-400' : 'text-gray-500'}>{sets.right}</span>
               </div>
               {isDeuce && <span className="text-[9px] sm:text-xs font-bold text-purple-400 animate-pulse">DEUCE</span>}
            </div>

            {/* Right Score */}
            <div className="flex items-center gap-3 sm:gap-4 flex-row-reverse text-right">
               <div className={`w-14 h-14 sm:w-24 sm:h-24 rounded-xl sm:rounded-2xl flex items-center justify-center text-4xl sm:text-6xl font-bold tabular-nums shadow-inner transition-colors duration-300 ${winner === 'right' ? 'bg-yellow-500 text-black scale-105' : 'bg-black/40 text-red-400'}`}>{scores.right}</div>
               <div>
                 <div className="text-lg sm:text-2xl font-bold text-red-400">{teams.right.name}</div>
                 <div className="text-[10px] sm:text-sm text-gray-400 flex gap-1.5 sm:gap-2 justify-end"><span>{teams.right.p1}</span>•<span>{teams.right.p2}</span></div>
               </div>
            </div>
          </div>
        </div>
      </header>

{/* 2. 🌟 중앙 메뉴 바 (심판 시점 및 DB 메뉴 배치) */}
      <div className="bg-slate-900 border-y border-slate-700 px-4 py-2 flex justify-between items-center z-20 shadow-inner">
        <button onClick={handleUmpirePosChange} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs sm:text-sm font-bold text-gray-200 transition-colors border border-slate-600">
          <span className="text-sm sm:text-base">🧭</span>
          <span>{umpirePosLabels[umpirePos]}</span>
        </button>

        <button onClick={() => setIsMenuOpen(true)} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs sm:text-sm font-bold text-gray-200 transition-colors border border-slate-600">
          <Database size={14} className={connectionStatus === 'connected' ? 'text-green-400' : 'text-gray-400'} />
          <span>DB 메뉴</span>
        </button>
      </div>

<main className="flex-1 relative flex items-center justify-center bg-emerald-800 p-2 sm:p-4 overflow-hidden">
        
	{/* 1. 히스토리 창 (좌측 하단 배치 & 문구 제거 & 2줄 제한) */}
        {isMatchStarted && displayLog.length > 0 && (
          <div className="absolute left-2 sm:left-4 bottom-4 z-40 pointer-events-none">
            <div className="bg-black/60 backdrop-blur-md rounded-xl p-2 w-40 sm:w-48 border border-white/10 shadow-2xl pointer-events-auto flex flex-col">
              <div className="overflow-y-auto flex flex-col gap-1.5 max-h-[52px] sm:max-h-[60px]">
                {displayLog.map((logState, idx) => {
                  const isLatest = idx === displayLog.length - 1;
                  
                  // 🌟 핵심 방어 로직: 어떤 버그로 인해 상태가 꼬여도 화면이 뻗지 않도록 ?(옵셔널 체이닝)과 ||(기본값)를 적용
                  const servingSide = logState.server || 'left';
                  const score = logState.scores ? logState.scores[servingSide] : 0;
                  const isEven = score % 2 === 0;
                  const activeBox = servingSide === 'left' ? (isEven ? 'bottom' : 'top') : (isEven ? 'top' : 'bottom');
                  const servingPlayerKey = logState.positions && logState.positions[servingSide] ? logState.positions[servingSide][activeBox] : 'p1';
                  const servingPlayerName = teams && teams[servingSide] ? teams[servingSide][servingPlayerKey] : 'Unknown';

                  return (
                    <div key={idx} className={`flex items-center justify-between w-full px-1 transition-all ${isLatest ? 'text-white font-extrabold scale-[1.02]' : 'text-gray-400 opacity-80 hover:opacity-100'}`}>
                      <div className="flex items-center gap-1.5 font-mono text-sm sm:text-base">
                        <span className={`${logState.scores && logState.scores.left > logState.scores.right ? 'text-blue-400' : 'text-white/80'}`}>{logState.scores ? logState.scores.left : 0}</span>
                        <span className="text-white/30 text-[10px]">-</span>
                        <span className={`${logState.scores && logState.scores.right > logState.scores.left ? 'text-red-400' : 'text-white/80'}`}>{logState.scores ? logState.scores.right : 0}</span>
                      </div>
                      <div className="text-[10px] sm:text-xs text-yellow-400/90 whitespace-nowrap bg-black/40 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                        <span className="text-[8px]">🎾</span>{getAcronym(servingPlayerName)}
                      </div>
                    </div>
                  );
                })}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>
        )}

        {isDbMatch && (
           <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-40 bg-black/50 backdrop-blur text-white px-2 py-1.5 sm:px-3 sm:py-2 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-bold border border-green-500 flex flex-col gap-1 shadow-lg pointer-events-none">
             <div className="flex items-center gap-1.5 sm:gap-2 text-green-400 mb-0.5 sm:mb-1"><div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-green-500 animate-pulse"></div>연동 중</div>
             <div className="text-gray-300 font-medium tracking-tight text-[9px] sm:text-[11px] truncate">📍 {teams.venue_name} - {teams.court_name}</div>
           </div>
        )}

        <div className={`
          relative bg-emerald-600 shadow-2xl flex transition-all duration-300
          border-t-2 border-l-2 border-r-2 sm:border-t-4 sm:border-l-4 sm:border-r-4 border-white
          border-b-[8px] sm:border-b-[16px] border-b-red-600
          ${!isMatchStarted ? 'scale-95 opacity-90' : 'scale-100'} 
          ${(umpirePos === 'E' || umpirePos === 'W') ? `flex-row w-[95vw] max-h-[60vh] aspect-[13.4/6.1] ${umpirePos === 'W' ? 'flex-row-reverse' : ''}` : ''}
          ${(umpirePos === 'S' || umpirePos === 'N') ? `flex-col h-[75vh] max-w-[90vw] aspect-[6.1/13.4] ${umpirePos === 'S' ? 'flex-col-reverse' : ''}` : ''}
        `}>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 bg-red-600 text-white/90 text-[10px] sm:text-xs font-bold px-4 py-0.5 rounded-t-lg z-30 tracking-widest shadow-sm pointer-events-none">심판석</div>
          <div className={`absolute z-20 bg-white/80 pointer-events-none ${umpirePos === 'E' || umpirePos === 'W' ? 'w-1.5 h-full left-1/2 -translate-x-1/2' : 'h-1.5 w-full top-1/2 -translate-y-1/2'}`}><div className="w-full h-full opacity-30 bg-[radial-gradient(circle,_#fff_1px,_transparent_1px)] bg-[size:4px_4px]"></div></div>
          <CourtSide side="left" score={scores.left} isServing={server === 'left'} teamData={teams.left} teamPositions={positions.left} onSwapPlayers={(s) => setPositions(prev => ({...prev, [s]: {top: prev[s].bottom, bottom: prev[s].top}}))} umpirePos={umpirePos} />
          <CourtSide side="right" score={scores.right} isServing={server === 'right'} teamData={teams.right} teamPositions={positions.right} onSwapPlayers={(s) => setPositions(prev => ({...prev, [s]: {top: prev[s].bottom, bottom: prev[s].top}}))} umpirePos={umpirePos} />
        </div>

        {!isMatchStarted && !isMatchOver && (
          <div className="absolute left-1/2 top-1/2 z-50 pointer-events-auto w-[90%] sm:w-auto transition-opacity duration-300 touch-none" style={{ transform: `translate(calc(-50% + ${modalPos.x}px), calc(-50% + ${modalPos.y}px))` }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
            <div className="bg-slate-900/95 backdrop-blur-md border-2 border-yellow-500/50 px-4 py-4 sm:px-6 rounded-2xl shadow-2xl flex flex-col items-center gap-3 cursor-move active:cursor-grabbing">
              <div className="w-full flex flex-col items-center pb-2 border-b border-white/10 pointer-events-none"><div className="w-12 h-1.5 bg-white/30 rounded-full mb-2"></div><span className="block font-bold text-white text-sm sm:text-lg select-none">{sets.left === 0 && sets.right === 0 ? "경기 시작 전 설정" : "새 세트 준비"}</span></div>
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                <button onClick={swapSides} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-semibold border border-slate-600 flex items-center gap-2 transition-colors text-white"><ArrowLeftRight size={16} className="text-purple-400" /> 코트 교체</button>
                <button onClick={() => setServer(server === 'left' ? 'right' : 'left')} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-semibold border border-slate-600 flex items-center gap-2 transition-colors text-yellow-400"><ArrowLeftRight size={16} /> 서브권 변경</button>
              </div>
              <button onClick={() => setIsMatchStarted(true)} className="w-full whitespace-nowrap px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl text-base sm:text-lg transition-transform active:scale-95 shadow-lg shadow-yellow-500/20 mt-1">준비 완료 (시작)</button>
              
              {/* 🌟 설정 창에도 다음 경기 불러오기 버튼 추가 */}
              {nextMatch && (
                <button onClick={handleLoadNextMatch} className="w-full mt-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition-transform active:scale-95 shadow-md flex justify-center items-center gap-2">
                  <Play size={16}/> 대기 중인 다음 경기 시작
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="bg-slate-800 border-t border-slate-700 p-4 shrink-0 z-20">
        <div className="max-w-4xl mx-auto flex justify-center items-center gap-6">
          <button onClick={undo} disabled={gameHistory.length === 0} className="flex flex-col items-center gap-1 group disabled:opacity-30">
            <div className="p-3 rounded-full bg-slate-700 group-hover:bg-slate-600 transition-colors"><RotateCcw size={20} className="text-slate-300" /></div><span className="text-xs text-slate-400">Undo</span>
          </button>
          
          <button onClick={() => setIsEditNamesOpen(true)} disabled={isMatchStarted} className="flex flex-col items-center gap-1 group disabled:opacity-30 disabled:cursor-not-allowed">
            <div className="p-3 rounded-full bg-slate-700 group-disabled:hover:bg-slate-700 group-hover:bg-blue-600 transition-colors"><Users size={20} className="text-blue-400 group-disabled:hover:text-blue-400 group-hover:text-white" /></div><span className="text-xs text-slate-400">Players</span>
          </button>
          
          <button onClick={swapSides} className="flex flex-col items-center gap-1 group">
            <div className="p-3 rounded-full bg-slate-700 group-hover:bg-purple-600 group-hover:text-white transition-colors"><ArrowLeftRight size={20} className="text-purple-400 group-hover:text-white" /></div><span className="text-xs text-slate-400">Swap</span>
          </button>
          
          <button onClick={() => setIsSettingsOpen(true)} disabled={isMatchStarted} className="flex flex-col items-center gap-1 group disabled:opacity-30 disabled:cursor-not-allowed">
            <div className="p-3 rounded-full bg-slate-700 group-disabled:hover:bg-slate-700 group-hover:bg-slate-600 transition-colors"><Settings size={20} className="text-slate-300" /></div><span className="text-xs text-slate-400">Setup</span>
          </button>
          
          {/* 🌟 핵심 기능: 대기열이 있을 경우 Reset 버튼이 'Next' 버튼으로 진화! */}
          <button onClick={() => {
            if (nextMatch) {
              if (window.confirm('현재 경기를 종료하고 대기 중인 다음 경기를 불러오시겠습니까?')) handleLoadNextMatch();
            } else {
              setIsResetConfirmOpen(true);
            }
          }} className="flex flex-col items-center gap-1 group relative">
            {nextMatch && <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-ping"></div>}
            {nextMatch && <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full"></div>}
            <div className={`p-3 rounded-full transition-colors ${nextMatch ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/50' : 'bg-slate-700 group-hover:bg-red-600 group-hover:text-white'}`}>
              <RefreshCcw size={20} className={nextMatch ? "text-white" : "text-red-400 group-hover:text-white"} />
            </div>
            <span className={`text-xs ${nextMatch ? 'text-blue-400 font-bold' : 'text-slate-400'}`}>{nextMatch ? 'Next' : 'Reset'}</span>
          </button>

        </div>
      </footer>

      {/* --- Modals --- */}
      {isEditNamesOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-xl border border-slate-700 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-white"><Users className="text-blue-400"/> 로컬 모드 팀/선수 설정</h3>
            <div className="mb-6 bg-slate-900/50 p-4 rounded-xl border border-slate-700">
              <label className="block text-sm text-gray-400 mb-2">명단에 새 선수 추가 (구글 시트 연동 X)</label>
              <div className="flex gap-2">
                <input value={newLocalPlayer} onChange={(e) => setNewLocalPlayer(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddLocalPlayer()} className="flex-1 bg-slate-800 border border-slate-600 rounded-lg p-2 text-sm text-white focus:border-blue-500 outline-none" placeholder="선수 이름 입력 후 엔터" />
                <button onClick={handleAddLocalPlayer} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold transition-colors shrink-0">추가</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="space-y-3">
                <input value={teams.left.name} onChange={(e) => setTeams({...teams, left: {...teams.left, name: e.target.value}})} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-blue-400 font-bold focus:border-blue-500 outline-none" placeholder="Team A Name" />
                <select value={teams.left.p1} onChange={(e) => setTeams({...teams, left: {...teams.left, p1: e.target.value}})} className="w-full bg-slate-700 border border-slate-600 rounded-lg p-2 text-sm focus:border-blue-500 outline-none text-white cursor-pointer">{localRoster.map(p => <option key={p} value={p}>{p}</option>)}</select>
                <select value={teams.left.p2} onChange={(e) => setTeams({...teams, left: {...teams.left, p2: e.target.value}})} className="w-full bg-slate-700 border border-slate-600 rounded-lg p-2 text-sm focus:border-blue-500 outline-none text-white cursor-pointer">{localRoster.map(p => <option key={p} value={p}>{p}</option>)}</select>
              </div>
              <div className="space-y-3">
                <input value={teams.right.name} onChange={(e) => setTeams({...teams, right: {...teams.right, name: e.target.value}})} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-red-400 font-bold focus:border-red-500 outline-none text-right" placeholder="Team B Name" />
                <select value={teams.right.p1} onChange={(e) => setTeams({...teams, right: {...teams.right, p1: e.target.value}})} className="w-full bg-slate-700 border border-slate-600 rounded-lg p-2 text-sm focus:border-red-500 outline-none text-right text-white cursor-pointer">{localRoster.map(p => <option key={p} value={p}>{p}</option>)}</select>
                <select value={teams.right.p2} onChange={(e) => setTeams({...teams, right: {...teams.right, p2: e.target.value}})} className="w-full bg-slate-700 border border-slate-600 rounded-lg p-2 text-sm focus:border-red-500 outline-none text-right text-white cursor-pointer">{localRoster.map(p => <option key={p} value={p}>{p}</option>)}</select>
              </div>
            </div>
            <button onClick={() => setIsEditNamesOpen(false)} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors">완료</button>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-xl border border-slate-700">
             <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Settings className="text-gray-400"/> 게임 설정</h3>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm text-gray-400 mb-1">내기 점수 (목표 점수)</label>
                <div className="flex items-center gap-3 bg-slate-900 rounded-lg p-2">
                  <button onClick={() => setMatchConfig(prev => ({...prev, pointsToWin: Math.max(5, prev.pointsToWin - 1)}))} className="w-10 h-10 flex items-center justify-center bg-slate-800 rounded-md text-gray-400 hover:text-white hover:bg-slate-700 text-xl font-bold transition-colors">-</button>
                  <input type="range" min="5" max="50" value={matchConfig.pointsToWin} onChange={(e) => setMatchConfig({...matchConfig, pointsToWin: parseInt(e.target.value)})} className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                  <button onClick={() => setMatchConfig(prev => ({...prev, pointsToWin: Math.min(50, prev.pointsToWin + 1)}))} className="w-10 h-10 flex items-center justify-center bg-slate-800 rounded-md text-gray-400 hover:text-white hover:bg-slate-700 text-xl font-bold transition-colors">+</button>
                  <span className="text-white font-bold text-lg w-12 text-center">{matchConfig.pointsToWin}점</span>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">듀스 규칙</label>
                <div className="flex bg-slate-900 rounded-lg p-1">
                  <button onClick={() => setMatchConfig({...matchConfig, deuceRule: '2-point'})} className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${matchConfig.deuceRule === '2-point' ? 'bg-slate-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}>2점차 (듀스 O)</button>
                  <button onClick={() => setMatchConfig({...matchConfig, deuceRule: '1-point'})} className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${matchConfig.deuceRule === '1-point' ? 'bg-slate-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}>1점차 (듀스 X)</button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">승리 세트 수</label>
                <div className="flex bg-slate-900 rounded-lg p-1">
                  {[1, 2, 3].map(st => (
                    <button key={st} onClick={() => setMatchConfig({...matchConfig, setsToWin: st})} className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${matchConfig.setsToWin === st ? 'bg-slate-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}>{st === 1 ? '단판' : st === 2 ? '3판 2선' : '5판 3선'}</button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={() => setIsSettingsOpen(false)} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-colors">닫기</button>
          </div>
        </div>
      )}

      {isSaving && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex flex-col items-center justify-center text-white text-xl font-bold">
          <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          데이터베이스 저장 중...
        </div>
      )}
      
      {isMatchOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
           <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 p-8 rounded-3xl text-center max-w-sm w-full shadow-2xl">
             <Trophy size={64} className="text-yellow-400 mx-auto mb-4" />
             <h2 className="text-3xl font-bold text-white mb-2">{teams[winner].name} 승리!</h2>
             <p className="text-slate-400 mb-8">{teams[winner].p1} & {teams[winner].p2} 팀이 경기를 이겼습니다.</p>
             {isDbMatch ? (
               <button onClick={saveResultsToDB} className="w-full py-4 bg-green-500 hover:bg-green-400 text-black font-bold rounded-xl flex items-center justify-center gap-2 mb-3 shadow-lg shadow-green-500/20"><Save size={20} /> 구글 시트에 결과 저장하기</button>
             ) : (
               <button onClick={() => executeReset(false)} className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl mb-3">새 경기 시작</button>
             )}
             {isDbMatch && (
               <div className="flex gap-2">
                 <button onClick={() => executeReset(false)} className="flex-1 py-3 bg-red-900/50 hover:bg-red-900 text-red-300 font-bold rounded-xl text-sm transition-colors border border-red-800/50">저장 안함 & 로컬 전환</button>
                 <button onClick={() => executeReset(true)} className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-gray-300 font-bold rounded-xl text-sm transition-colors">저장 안함 & 재대결</button>
               </div>
             )}
           </div>
        </div>
      )}

      {isResetConfirmOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-xl border border-slate-700 text-center">
            <h3 className="text-xl font-bold text-white mb-4">경기 초기화</h3>
            <p className="text-slate-400 mb-6 text-sm">진행 중인 경기를 완전히 초기화하시겠습니까?<br/>(DB 연동이 해제됩니다)</p>
            <div className="flex gap-4">
              <button onClick={() => setIsResetConfirmOpen(false)} className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-colors">취소</button>
              <button onClick={() => executeReset(false)} className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold transition-colors">초기화</button>
            </div>
          </div>
        </div>
      )}

      {/* ★ DB Management Sidebar (The Unified Interface) ★ */}
      {isMenuOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex justify-end">
          <div className="w-full max-w-md bg-gray-50 h-full shadow-2xl flex flex-col animate-in slide-in-from-right text-gray-800">
            <div className="bg-white px-6 py-4 flex items-center justify-between border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Database size={20} className="text-green-600"/> 데이터베이스 메뉴</h2>
              <button onClick={() => setIsMenuOpen(false)} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600"><X size={20}/></button>
            </div>

	    {/* DB 메뉴 상단 탭 부분 - App.jsx 중간 지점 */}
	<div className="flex border-b border-gray-200 bg-gray-50">
	  <button 
	    onClick={() => setAdminTab('manage')} 
	    disabled={isMatchStarted} 
	    className={`flex-1 py-4 text-sm font-bold transition-colors flex items-center justify-center gap-2 
	      ${adminTab === 'manage' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-100'}
	      ${isMatchStarted ? 'opacity-50 cursor-not-allowed' : ''}`}
	  >
	    <Users size={18} /> 정보 관리
	  </button>
	  
	  {/* 🌟 수정: disabled={isMatchStarted} 를 제거하여 경기 중에도 설정 탭 진입 허용 */}
	  <button 
	    onClick={() => setAdminTab('match')} 
	    className={`flex-1 py-4 text-sm font-bold transition-colors flex items-center justify-center gap-2 
	      ${adminTab === 'match' ? 'bg-white text-yellow-600 border-b-2 border-yellow-600' : 'text-gray-500 hover:bg-gray-100'}`}
	  >
	    <Play size={18} /> 경기 시작/설정
	  </button>
	  
	  <button 
	    onClick={() => setAdminTab('connect')} 
	    className={`...`} 
	  >
	    <Database size={18} /> DB 연결
	  </button>
	</div>

            <div className="flex-1 overflow-y-auto p-6">
              {adminTab === 'connect' && (
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <label className="block text-sm font-bold text-gray-700 mb-2">Google Apps Script URL 입력</label>
                    <input type="text" value={gasUrl} onChange={(e) => setGasUrl(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg text-sm mb-3 outline-none focus:border-blue-500 font-mono transition-colors" placeholder="https://script.google.com/macros/s/.../exec" />

                    {/* 🌟 북마크 저장 기능 UI */}
                    <div className="flex gap-2 mb-4 bg-gray-50 p-3 rounded-lg border border-gray-200">
                       <input type="text" value={bookmarkName} onChange={(e) => setBookmarkName(e.target.value)} className="flex-1 p-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500" placeholder="북마크 이름 (예: 월수금 클럽용)" />
                       <button onClick={handleSaveBookmark} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-bold transition-colors whitespace-nowrap shadow-sm">북마크 저장</button>
                    </div>

                    {/* 🌟 저장된 북마크 목록 불러오기 */}
                    {bookmarks.length > 0 && (
                      <div className="mb-5">
                        <div className="text-xs font-bold text-gray-500 mb-2 px-1">저장된 북마크 목록</div>
                        <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                          {bookmarks.map((b, i) => (
                            <div key={i} className={`flex justify-between items-center p-2 rounded-lg border transition-colors ${gasUrl === b.url ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                              {/* 북마크 이름을 누르면 URL이 자동 입력됨 */}
                              <button onClick={() => setGasUrl(b.url)} className="flex-1 text-left text-sm font-semibold text-gray-700 truncate hover:text-blue-600">🔖 {b.name}</button>
                              <button onClick={() => handleDeleteBookmark(b.url)} className="text-gray-400 hover:text-red-500 p-1 ml-2" title="북마크 삭제"><Trash2 size={16} /></button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button onClick={handleConnect} disabled={connectionStatus === 'connecting'} className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-bold shadow-md transition-transform active:scale-95 flex justify-center items-center gap-2 text-lg mt-2">
                      {connectionStatus === 'connecting' ? <RefreshCcw className="animate-spin" size={20} /> : <Database size={20} />} DB 연결하기
                    </button>
                  </div>
                  
                  <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                    <h4 className="font-bold text-blue-800 text-sm flex items-center gap-2 mb-2"><AlertCircle size={16}/> API 연동 방법</h4>
                    <ol className="text-xs text-blue-700 space-y-1.5 list-decimal list-inside font-medium">
                      <li>구글 스프레드시트에서 <strong>[확장 프로그램] - [Apps Script]</strong> 열기</li>
                      <li>위의 코드를 복사하여 붙여넣고 저장</li>
                      <li><strong>[배포] - [새 배포]</strong> 클릭 (유형: 웹 앱)</li>
                      <li>액세스 권한을 <strong>'모든 사용자'</strong>로 설정 후 배포</li>
                      <li>생성된 <strong>웹 앱 URL</strong>을 복사하여 위 칸에 붙여넣기</li>
                    </ol>
                  </div>
                </div>
              )}

              {adminTab === 'manage' && (
                <div className="space-y-6">
                  {connectionStatus !== 'connected' ? <p className="text-gray-500 text-center font-semibold">연결 탭에서 먼저 연결해주세요.</p> : (
                    <>
                      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                        <h3 className="font-bold mb-3 flex items-center gap-2 text-gray-800"><Building size={18}/> 소속 클럽</h3>
                        <div className="flex gap-2 mb-3">
                          <input type="text" placeholder="새 클럽 추가" value={newClubName} onChange={(e)=>setNewClubName(e.target.value)} className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm outline-none focus:border-green-500 transition-colors" />
                          <button onClick={handleAddClub} disabled={isProcessing} className="px-4 bg-green-600 text-white rounded-lg text-sm font-bold disabled:opacity-50 transition-colors">추가</button>
                        </div>
                        <select value={selectedClubId} onChange={(e)=>setSelectedClubId(e.target.value)} className="w-full p-2 bg-gray-50 border border-gray-300 rounded-lg font-semibold text-sm outline-none focus:border-green-500 transition-colors">
                          <option value="">-- 클럽을 선택하세요 --</option>
                          {clubs.map(c => <option key={c.club_id} value={c.club_id}>{c.name}</option>)}
                        </select>
                      </div>

                      {selectedClubId && (
                        <>
                          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                            <h3 className="font-bold mb-3 flex items-center gap-2 text-gray-800"><MapPin size={18}/> 1. 구장 등록</h3>
                            <div className="flex gap-2 mb-4">
                              <input type="text" placeholder="예: 화성실내배드민턴장" value={newVenueName} onChange={(e)=>setNewVenueName(e.target.value)} className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm outline-none focus:border-blue-500 transition-colors" />
                              <button onClick={handleAddVenue} disabled={isProcessing} className="px-4 bg-blue-600 text-white rounded-lg text-sm font-bold disabled:opacity-50 transition-colors">구장 추가</button>
                            </div>
                            
                            <h3 className="font-bold mb-3 flex items-center gap-2 text-gray-800"><MapPin size={18}/> 2. 코트 등록</h3>
                            <div className="flex flex-col gap-2">
                              <select value={manageSelectedVenue} onChange={(e)=>setManageSelectedVenue(e.target.value)} className="w-full p-2 bg-gray-50 border border-gray-300 rounded-lg font-semibold text-sm outline-none focus:border-blue-500 transition-colors">
                                <option value="">-- 코트를 추가/조회할 구장 선택 --</option>
                                {venues.map(v => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
                              </select>
                              {manageSelectedVenue && (
                                <div className="flex gap-2 mt-1 p-3 bg-blue-50 rounded-lg border border-blue-100">
                                  <input type="text" placeholder="예: 초급1코트" value={newCourtName} onChange={(e)=>setNewCourtName(e.target.value)} className="flex-1 bg-white border border-blue-200 rounded-lg p-2 text-sm outline-none focus:border-blue-500 transition-colors" />
                                  <button onClick={handleAddCourt} disabled={isProcessing} className="px-4 bg-blue-600 text-white rounded-lg text-sm font-bold disabled:opacity-50 transition-colors">코트 추가</button>
                                </div>
                              )}
                            </div>

                            {manageSelectedVenue && courts.filter(c => String(c.venue_id) === String(manageSelectedVenue)).length > 0 && (
                              <div className="mt-4">
                                <h4 className="text-xs font-bold text-gray-500 mb-2">선택한 구장의 코트 목록</h4>
                                <div className="flex gap-2">
                                  <select value={manageSelectedCourt} onChange={(e)=>setManageSelectedCourt(e.target.value)} className="flex-1 p-2 bg-gray-50 border border-gray-300 rounded-lg font-semibold text-sm outline-none focus:border-red-500 transition-colors">
                                    <option value="">-- 삭제할 코트 선택 --</option>
                                    {courts.filter(c => String(c.venue_id) === String(manageSelectedVenue)).map(c => <option key={c.court_id} value={c.court_id}>{c.name}</option>)}
                                  </select>
                                  <button onClick={handleDeleteCourt} disabled={isProcessing || !manageSelectedCourt} className="px-4 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg text-sm font-bold disabled:opacity-50 transition-colors shrink-0"><Trash2 size={16}/></button>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                            <h3 className="font-bold mb-3 flex items-center gap-2 text-gray-800"><Users size={18}/> 새 선수 등록</h3>
                            <div className="text-xs text-purple-600 bg-purple-50 p-2 rounded mb-3 border border-purple-100">
                              이름, 생년, 분류가 일치하는 선수가 이미 DB에 있다면 자동으로 기존 데이터와 연동됩니다. (여러 클럽 소속 가능)
                            </div>
                            <div className="flex gap-2 mb-2">
                              <input type="text" placeholder="선수 이름" value={newPlayerName} onChange={(e)=>setNewPlayerName(e.target.value)} className="flex-1 w-full bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm outline-none focus:border-purple-500 transition-colors" />
                              <button onClick={handleAddPlayer} disabled={isProcessing} className="px-4 bg-purple-600 text-white rounded-lg text-sm font-bold disabled:opacity-50 transition-colors shrink-0">등록</button>
                            </div>
                            <div className="flex gap-2">
                              <input type="text" placeholder="생년(예:900101)" value={newPlayerBirthdate} onChange={(e)=>setNewPlayerBirthdate(e.target.value)} className="flex-1 bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm outline-none focus:border-purple-500 transition-colors" />
                              <input type="text" placeholder="분류(A,B)" value={newPlayerDistinguisher} onChange={(e)=>setNewPlayerDistinguisher(e.target.value)} className="w-20 bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm outline-none focus:border-purple-500 transition-colors shrink-0" />
                            </div>

                            <h3 className="font-bold mb-3 mt-6 flex items-center gap-2 text-gray-600"><Users size={16}/> 현재 클럽 선수 명단</h3>
                            <div className="flex gap-2">
                              <select value={manageSelectedPlayer} onChange={(e)=>setManageSelectedPlayer(e.target.value)} className="flex-1 p-2 bg-gray-50 border border-gray-300 rounded-lg font-semibold text-sm outline-none focus:border-purple-500 transition-colors">
                                <option value="">-- 클럽에서 제외할 선수 선택 ({players.length}명) --</option>
                                {players.map(p => <option key={p.player_id} value={p.player_id}>{formatPlayerDisplay(p)}</option>)}
                              </select>
                              <button onClick={handleDeletePlayer} disabled={isProcessing || !manageSelectedPlayer} className="px-4 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg text-sm font-bold disabled:opacity-50 transition-colors shrink-0">제외</button>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

             {adminTab === 'match' && (
                <div className="space-y-6">
                  {(!selectedClubId || players.length < 4) ? (
                    <div className="text-center p-6 bg-yellow-50 rounded-xl border border-yellow-200">
                      <AlertCircle className="mx-auto text-yellow-500 mb-2" size={32}/>
                      <p className="text-sm text-yellow-800 font-semibold leading-relaxed">클럽을 선택하고, 최소 4명의 선수를 먼저 등록해야 경기를 시작할 수 있습니다.</p>
                    </div>
                  ) : (
                    <>
                      <div className="bg-white p-4 rounded-xl border border-gray-200">
                        <label className="block text-sm font-bold text-gray-700 mb-2">경기 장소 선택</label>
                        <select value={playVenueId} onChange={(e)=>setPlayVenueId(e.target.value)} className="w-full mb-3 p-3 bg-gray-50 border border-gray-300 rounded-lg text-sm outline-none focus:border-yellow-500 font-semibold transition-colors">
                          <option value="">-- 경기장(구장) 선택 --</option>
                          {venues.map(v => <option key={v.venue_id} value={v.venue_id}>{v.name}</option>)}
                        </select>
                        <select value={playCourtId} onChange={(e)=>setPlayCourtId(e.target.value)} disabled={!playVenueId} className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg text-sm outline-none focus:border-yellow-500 font-semibold transition-colors disabled:opacity-50">
                          <option value="">-- 코트 선택 --</option>
                          {courts.filter(c => String(c.venue_id) === String(playVenueId)).map(c => <option key={c.court_id} value={c.court_id}>{c.name}</option>)}
                        </select>
                      </div>

                      {/* 🌟 Left 팀 선수 선택 (다른 3자리에 이미 들어간 선수는 disabled 처리) */}
                      <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
                        <div className="flex items-center gap-2 mb-3">
                          <h3 className="font-bold text-blue-800 text-sm whitespace-nowrap">Left 팀명:</h3>
                          <input type="text" value={playTeamA.name} onChange={(e)=>setPlayTeamA({...playTeamA, name: e.target.value})} className="flex-1 p-1.5 rounded-lg border border-blue-200 text-sm font-bold text-blue-800 outline-none bg-white focus:border-blue-500" placeholder="A팀 이름" />
                        </div>
                        <select value={playTeamA.p1} onChange={(e)=>setPlayTeamA({...playTeamA, p1: e.target.value})} className="w-full mb-2 p-2 rounded-lg border border-blue-200 text-sm outline-none bg-white transition-colors">
                          <option value="">-- 선수 1 --</option>
                          {players.map(p => <option key={p.player_id} value={p.player_id} disabled={[playTeamA.p2, playTeamB.p1, playTeamB.p2].includes(String(p.player_id))}>{formatPlayerDisplay(p)}</option>)}
                        </select>
                        <select value={playTeamA.p2} onChange={(e)=>setPlayTeamA({...playTeamA, p2: e.target.value})} className="w-full p-2 rounded-lg border border-blue-200 text-sm outline-none bg-white transition-colors">
                          <option value="">-- 선수 2 --</option>
                          {players.map(p => <option key={p.player_id} value={p.player_id} disabled={[playTeamA.p1, playTeamB.p1, playTeamB.p2].includes(String(p.player_id))}>{formatPlayerDisplay(p)}</option>)}
                        </select>
                      </div>

                      {/* 🌟 Right 팀 선수 선택 (다른 3자리에 이미 들어간 선수는 disabled 처리) */}
                      <div className="bg-red-50 p-4 rounded-xl border border-red-200">
                        <div className="flex items-center gap-2 mb-3">
                          <h3 className="font-bold text-red-800 text-sm whitespace-nowrap">Right 팀명:</h3>
                          <input type="text" value={playTeamB.name} onChange={(e)=>setPlayTeamB({...playTeamB, name: e.target.value})} className="flex-1 p-1.5 rounded-lg border border-red-200 text-sm font-bold text-red-800 outline-none bg-white focus:border-red-500" placeholder="B팀 이름" />
                        </div>
                        <select value={playTeamB.p1} onChange={(e)=>setPlayTeamB({...playTeamB, p1: e.target.value})} className="w-full mb-2 p-2 rounded-lg border border-red-200 text-sm outline-none bg-white transition-colors">
                          <option value="">-- 선수 1 --</option>
                          {players.map(p => <option key={p.player_id} value={p.player_id} disabled={[playTeamA.p1, playTeamA.p2, playTeamB.p2].includes(String(p.player_id))}>{formatPlayerDisplay(p)}</option>)}
                        </select>
                        <select value={playTeamB.p2} onChange={(e)=>setPlayTeamB({...playTeamB, p2: e.target.value})} className="w-full p-2 rounded-lg border border-red-200 text-sm outline-none bg-white transition-colors">
                          <option value="">-- 선수 2 --</option>
                          {players.map(p => <option key={p.player_id} value={p.player_id} disabled={[playTeamA.p1, playTeamA.p2, playTeamB.p1].includes(String(p.player_id))}>{formatPlayerDisplay(p)}</option>)}
                        </select>
                      </div>

		      {/* 🌟 2단계 수정: 버튼 2개(즉시 시작 / 다음경기 대기) 분리 및 대기표 UI */}
                      <div className="flex gap-2 mt-2">
                        <button onClick={handleStartDbMatch} disabled={isMatchStarted} className="flex-1 py-3 sm:py-4 bg-yellow-500 hover:bg-yellow-400 text-black rounded-xl font-bold shadow-lg flex justify-center items-center gap-2 transition-transform active:scale-95 text-sm sm:text-lg disabled:opacity-50 disabled:cursor-not-allowed">
                          <Play size={20} /> 즉시 시작
                        </button>
                        <button onClick={handleQueueNextMatch} className="flex-1 py-3 sm:py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg flex justify-center items-center gap-1 transition-transform active:scale-95 text-sm sm:text-lg disabled:opacity-50 disabled:cursor-not-allowed">
                          <Plus size={18} /> 다음경기 대기
                        </button>
                      </div>

                      {nextMatch && (
                        <div className="mt-4 bg-slate-800 p-3 sm:p-4 rounded-xl border border-blue-500/50 relative animate-in fade-in">
                          <button onClick={() => setNextMatch(null)} className="absolute top-2 right-2 text-gray-400 hover:text-red-400 p-1"><X size={16}/></button>
                          <h4 className="text-xs sm:text-sm font-bold text-blue-400 mb-2 flex items-center gap-1.5">📥 다음 경기 대기 중</h4>
                          <div className="text-[10px] sm:text-xs text-gray-300 space-y-1">
                            <div><span className="font-bold text-gray-100">A팀:</span> {nextMatch.left.name} <span className="text-gray-500">({nextMatch.left.p1}, {nextMatch.left.p2})</span></div>
                            <div><span className="font-bold text-gray-100">B팀:</span> {nextMatch.right.name} <span className="text-gray-500">({nextMatch.right.p1}, {nextMatch.right.p2})</span></div>
                          </div>
                        </div>
                      )}

                    </>
                  )}
                </div>
              )} 
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;

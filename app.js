/* ===================================================
   KASIR ATK & PRINT-FOTOCOPY — app.js  v3
   Backend: Google Apps Script + Google Sheets
   =================================================== */
'use strict';

// ================================================================
//  ▼▼▼ GANTI URL INI setelah deploy Google Apps Script ▼▼▼
// ================================================================
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyVnkh38UMac7tzzc2Fke0yYvWdxUhjvsaV3Tmc-WSLK6tzCerqhmW_5C0sIHso8D_o8Q/exec';
//  Contoh: 'https://script.google.com/macros/s/AKfyc.../exec'
// ================================================================

// ===== CONSTANTS =====
const LAYANAN = {
  ATK: [
    'Pulpen','Pensil','Pensil Warna','Pulpen Gel','Spidol Permanen','Spidol Whiteboard',
    'Buku Tulis','Buku Gambar','Buku Folio','Block Note','Agenda/Diary',
    'Penghapus','Penggaris','Penggaris Segitiga','Busur Derajat',
    'Staples & Isi Staples','Klip Kertas (Binder Clip)','Gembok Kertas',
    'Tipe-X (Correction Pen)','Correction Tape','Lem Kertas','Lem Stick',
    'Map Plastik','Map Karton','Ordner/Binder','Stopmap Kertas','Hanging Folder',
    'Amplop Putih','Amplop Coklat','Amplop Besar',
    'Sticky Note','Label Sticker','Kertas HVS A4','Kertas HVS F4','Kertas Buffalo',
    'Kertas Inkjet Foto','Plastik Laminating','Tinta Printer','Cartridge Printer',
    'Materai 10000','Materai 6000',
    'Gunting','Cutter','Isi Cutter','Penjepit Rambut Kertas',
    'Kalkulator','Tempat Pensil','Rautan Pensil','Dan lain-lain'
  ],
  'Print-Fotocopy': [
    'Fotocopy Hitam Putih','Fotocopy Warna','Fotocopy Bolak-Balik',
    'Print Hitam Putih','Print Warna','Print Foto','Print Copy',
    'Laminating A4','Laminating F4','Laminating ID Card',
    'Scan Dokumen','Scan ke PDF','Scan ke JPEG',
    'Jilid Kawat','Jilid Spiral','Jilid Lem Panas','Jilid Mika',
    'Cetak Banner','Cetak Spanduk','Cetak Poster','Cetak ID Card',
    'Cetak Undangan','Cetak Stiker','Cetak Buku Kenangan',
    'Binder Ring','Plastik Cover Jilid',
    'Pengiriman Email / WhatsApp File','Kartu Nama','Dan lain-lain'
  ]
};
const BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

// ===== STATE =====
let transactions    = [];
let filteredData    = [];
let deleteTargetId  = null;
let deleteBulkMode  = false;
let charts          = {};
let viewMode        = 'today';
let pendingImportData = [];
let isOnline        = true;   // status koneksi ke GAS
let syncPending     = false;  // ada data lokal yang belum tersync

// ===== OFFLINE FALLBACK — LocalStorage =====
const LS_KEY      = 'kasir_atk_transactions';
const LS_INIT_KEY = 'kasir_atk_initialized';

function lsLoad() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw !== null ? (JSON.parse(raw) || []) : [];
  } catch { return []; }
}
function lsSave(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch(e) {}
}
function isStorageAvailable() {
  try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; }
  catch { return false; }
}

// ===== API CALLS ke Google Apps Script =====
async function gasGet(params = {}) {
  const url = new URL(GAS_URL);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const res  = await fetch(url.toString());
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function gasPost(body) {
  const res  = await fetch(GAS_URL, {
    method: 'POST',
    body:   JSON.stringify(body)
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// ===== GAS CONFIGURED? =====
function gasConfigured() {
  return GAS_URL && GAS_URL !== 'GANTI_DENGAN_URL_WEB_APP_ANDA' && GAS_URL.startsWith('https://');
}

// ===== LOAD DATA (dari GAS atau localStorage fallback) =====
async function loadData() {
  showLoadingOverlay(true);
  if (!gasConfigured()) {
    // Mode offline / belum setup: pakai localStorage
    transactions = lsLoad();
    isOnline = false;
    updateOnlineStatus(false, 'localStorage (offline mode)');
    showLoadingOverlay(false);
    return;
  }
  try {
    const result = await gasGet({ action: 'getAll' });
    transactions = result.data || [];
    lsSave(transactions); // simpan lokal sebagai cache
    isOnline = true;
    updateOnlineStatus(true, 'Google Sheets');
  } catch(err) {
    console.warn('GAS error, fallback ke localStorage:', err);
    transactions = lsLoad();
    isOnline = false;
    updateOnlineStatus(false, 'Offline — data dari cache lokal');
    showToast('⚠️ Gagal terhubung ke server, tampil data cache', 'error');
  }
  showLoadingOverlay(false);
}

// ===== SAVE / SYNC HELPERS =====
async function gasAddTransaction(t) {
  if (!gasConfigured() || !isOnline) { lsSave(transactions); return; }
  try { await gasPost({ action: 'add', data: t }); lsSave(transactions); }
  catch(e) { lsSave(transactions); showToast('⚠️ Tersimpan lokal, sync ke server gagal','error'); }
}
async function gasUpdateTransaction(t) {
  if (!gasConfigured() || !isOnline) { lsSave(transactions); return; }
  try { await gasPost({ action: 'update', data: t }); lsSave(transactions); }
  catch(e) { lsSave(transactions); showToast('⚠️ Update lokal, sync ke server gagal','error'); }
}
async function gasDeleteTransaction(id) {
  if (!gasConfigured() || !isOnline) { lsSave(transactions); return; }
  try { await gasPost({ action: 'delete', id }); lsSave(transactions); }
  catch(e) { lsSave(transactions); showToast('⚠️ Hapus lokal, sync ke server gagal','error'); }
}
async function gasBulkDelete(ids) {
  if (!gasConfigured() || !isOnline) { lsSave(transactions); return; }
  try { await gasPost({ action: 'bulkDelete', ids }); lsSave(transactions); }
  catch(e) { lsSave(transactions); showToast('⚠️ Hapus lokal, sync ke server gagal','error'); }
}
async function gasImport(data) {
  if (!gasConfigured() || !isOnline) { lsSave(transactions); return; }
  try { await gasPost({ action: 'import', data }); lsSave(transactions); }
  catch(e) { lsSave(transactions); showToast('⚠️ Import lokal, sync ke server gagal','error'); }
}

// ===== STATUS INDICATOR =====
function updateOnlineStatus(online, label) {
  const el = document.getElementById('onlineStatus');
  if (!el) return;
  el.className = 'status-dot ' + (online ? 'online' : 'offline');
  el.title = label;
  const lbl = document.getElementById('onlineLabel');
  if (lbl) lbl.textContent = label;
}

function showLoadingOverlay(show) {
  const el = document.getElementById('loadingOverlay');
  if (el) el.style.display = show ? 'flex' : 'none';
}

// ===== DARK MODE =====
function loadDarkMode() {
  const dark = localStorage.getItem('kasir_dark') === '1';
  applyDark(dark);
  document.getElementById('darkModeToggle').checked  = dark;
  document.getElementById('darkModeToggle2').checked = dark;
}
function toggleDarkMode(on) {
  localStorage.setItem('kasir_dark', on ? '1' : '0');
  applyDark(on);
  document.getElementById('darkModeToggle').checked  = on;
  document.getElementById('darkModeToggle2').checked = on;
}
function applyDark(on) {
  document.body.classList.toggle('dark', on);
  if (document.getElementById('page-dashboard').classList.contains('active')) renderCharts();
}

// ===== HELPERS =====
function rupiah(n)  { return 'Rp ' + Math.round(n||0).toLocaleString('id-ID'); }
function parseRupiah(str) { return parseInt((str||'').toString().replace(/\D/g,''))||0; }
function formatRupiah(input) {
  const v = parseRupiah(input.value);
  input.value = v === 0 ? '' : v.toLocaleString('id-ID');
}
function genId()   { return Date.now().toString(36) + Math.random().toString(36).substr(2,5); }
function nextNo()  { return transactions.length === 0 ? 1 : Math.max(...transactions.map(t=>t.no)) + 1; }
function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID',{day:'2-digit',month:'2-digit',year:'numeric'})
       + ' ' + d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
}
function today() { return new Date().toISOString().split('T')[0]; }

function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  setTimeout(()=>{ t.className='toast'; }, 3000);
}

// ===== CLOCK =====
function updateClock() {
  const now = new Date();
  const el = document.getElementById('topbarTime');
  if (el) el.textContent = now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const sd = document.getElementById('sidebarDate');
  if (sd) sd.textContent = now.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}
setInterval(updateClock, 1000);
updateClock();

// ===== REFRESH MANUAL (klik tombol untuk tarik data terbaru dari server) =====
let isRefreshing = false;
async function manualRefresh() {
  if (!gasConfigured()) {
    showToast('⚠️ Google Sheets belum disetel, masih pakai data lokal', 'error');
    return;
  }
  if (isRefreshing) return;
  isRefreshing = true;
  setRefreshButtonState(true);
  try {
    const result = await gasGet({ action: 'getAll' });
    transactions = result.data || [];
    lsSave(transactions);
    isOnline = true;
    updateOnlineStatus(true, 'Google Sheets');
    // Re-render halaman yang sedang aktif
    const activePage = document.querySelector('.page.active');
    if (activePage) {
      const pid = activePage.id;
      if (pid === 'page-dashboard') refreshDashboard();
      if (pid === 'page-riwayat')  setViewMode(viewMode, true);
    }
    showToast('🔄 Data berhasil diperbarui dari server', 'success');
  } catch(e) {
    isOnline = false;
    updateOnlineStatus(false, 'Offline — gagal terhubung');
    showToast('⚠️ Gagal mengambil data terbaru. Periksa koneksi.', 'error');
  } finally {
    isRefreshing = false;
    setRefreshButtonState(false);
  }
}
function setRefreshButtonState(loading) {
  document.querySelectorAll('.btn-refresh').forEach(btn => {
    btn.disabled = loading;
    btn.classList.toggle('spinning', loading);
  });
}

// ===== NAVIGATION =====
function showPage(name) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  document.querySelectorAll('[data-page="'+name+'"]').forEach(n=>n.classList.add('active'));
  const titles = {dashboard:'Dashboard', transaksi:'Input Transaksi', riwayat:'Riwayat Transaksi'};
  document.getElementById('pageTitle').textContent = titles[name]||name;
  if (name==='dashboard') refreshDashboard();
  if (name==='riwayat')   setViewMode(viewMode, true);
  if (name==='transaksi') initForm();
  closeSidebar();
}
document.querySelectorAll('[data-page]').forEach(el=>{
  el.addEventListener('click', e=>{ e.preventDefault(); showPage(el.dataset.page); });
});
function openSidebar()  { document.getElementById('sidebar').classList.add('open'); document.getElementById('overlay').classList.add('show'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('show'); }
document.getElementById('menuBtn').addEventListener('click', openSidebar);
document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
document.getElementById('overlay').addEventListener('click', closeSidebar);

// ===== VIEW MODE =====
function setViewMode(mode, force=false) {
  if (viewMode === mode && !force) return;
  viewMode = mode;
  document.getElementById('btnViewToday').classList.toggle('active', mode==='today');
  document.getElementById('btnViewAll').classList.toggle('active', mode==='all');
  document.getElementById('filterSearch').value = '';
  document.getElementById('filterDate').value   = '';
  document.getElementById('filterMonth').value  = '';
  document.getElementById('filterJenis').value  = '';
  const base = mode==='today' ? transactions.filter(t=>t.datetime.startsWith(today())) : [...transactions];
  renderHistory(base);
}

// ===== FORM =====
function initForm() {
  const no = nextNo(), padded = String(no).padStart(3,'0');
  document.getElementById('fNoTrans').value = 'TRX-'+padded;
  document.getElementById('transNoBadge').textContent = '#'+padded;
  document.getElementById('fDateTime').value = new Date().toLocaleString('id-ID');
  document.getElementById('fJenis').value = '';
  document.getElementById('fLayanan').innerHTML = '<option value="">-- Pilih Layanan --</option>';
  document.getElementById('fJumlah').value = '';
  document.getElementById('fKeterangan').value = '';
  document.querySelector('input[name="fPayment"][value="Cash"]').checked = true;
}
function updateLayanan() {
  const jenis = document.getElementById('fJenis').value;
  const sel   = document.getElementById('fLayanan');
  sel.innerHTML = '<option value="">-- Pilih Layanan --</option>';
  (LAYANAN[jenis]||[]).forEach(l=>{ const o=document.createElement('option'); o.value=l; o.textContent=l; sel.appendChild(o); });
}
function resetForm() { initForm(); }

async function saveTransaksi() {
  const jenis   = document.getElementById('fJenis').value;
  const layanan = document.getElementById('fLayanan').value;
  const jumlah  = parseRupiah(document.getElementById('fJumlah').value);
  const payment = document.querySelector('input[name="fPayment"]:checked').value;
  const ket     = document.getElementById('fKeterangan').value.trim();
  if (!jenis)            { showToast('Pilih jenis transaksi!','error'); return; }
  if (!layanan)          { showToast('Pilih detail layanan!','error'); return; }
  if (!jumlah||jumlah<=0){ showToast('Masukkan jumlah transaksi!','error'); return; }

  const no  = nextNo();
  const trx = { id:genId(), no, datetime:new Date().toISOString(), jenis, layanan, jumlah, payment, keterangan:ket };

  // Optimistic update: tambah ke array lokal dulu agar UI responsif
  transactions.push(trx);
  showToast('💾 Menyimpan...','success');

  await gasAddTransaction(trx);
  showToast('✅ Transaksi #'+String(no).padStart(3,'0')+' berhasil disimpan!','success');
  initForm();
  refreshDashboard();
}

// ===== HISTORY =====
function renderHistory(data) {
  filteredData = data || [];
  const tbody = document.getElementById('historyBody');
  const ca    = document.getElementById('checkAll');
  if (ca) ca.checked = false;
  updateBulkDeleteBtn();

  if (!filteredData.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">${viewMode==='today'?'📭 Belum ada transaksi hari ini':'📭 Belum ada data transaksi'}</td></tr>`;
    updateRekap([]);
    return;
  }
  const sorted = [...filteredData].sort((a,b)=>new Date(b.datetime)-new Date(a.datetime));
  tbody.innerHTML = sorted.map((t,i)=>`
    <tr data-id="${t.id}">
      <td class="no-print col-check">
        <label class="cb-label"><input type="checkbox" class="row-check" value="${t.id}" onchange="onRowCheck()"><span class="cb-custom"></span></label>
      </td>
      <td><strong>${i+1}</strong></td>
      <td style="white-space:nowrap;font-size:12px">${fmtDateTime(t.datetime)}</td>
      <td><span class="badge ${t.jenis==='ATK'?'badge-atk':'badge-print'}">${t.jenis}</span></td>
      <td>${t.layanan}</td>
      <td style="font-weight:700;white-space:nowrap">${rupiah(t.jumlah)}</td>
      <td><span class="badge ${t.payment==='Cash'?'badge-cash':'badge-transfer'}">${t.payment}</span></td>
      <td style="max-width:160px;font-size:12px;color:var(--text-muted)">${t.keterangan||'—'}</td>
      <td class="no-print">
        <div class="action-btns">
          <button class="btn-icon btn-edit" onclick="openEdit('${t.id}')">✏️</button>
          <button class="btn-icon btn-delete" onclick="openDelete('${t.id}')">🗑️</button>
        </div>
      </td>
    </tr>`).join('');
  updateRekap(filteredData);
}

function updateRekap(data) {
  const atk=data.filter(t=>t.jenis==='ATK').reduce((s,t)=>s+t.jumlah,0);
  const prt=data.filter(t=>t.jenis==='Print-Fotocopy').reduce((s,t)=>s+t.jumlah,0);
  const csh=data.filter(t=>t.payment==='Cash').reduce((s,t)=>s+t.jumlah,0);
  const trf=data.filter(t=>t.payment==='Transfer').reduce((s,t)=>s+t.jumlah,0);
  document.getElementById('rekapATK').textContent      = rupiah(atk);
  document.getElementById('rekapPrint').textContent    = rupiah(prt);
  document.getElementById('rekapCash').textContent     = rupiah(csh);
  document.getElementById('rekapTransfer').textContent = rupiah(trf);
  document.getElementById('rekapGrand').textContent    = rupiah(atk+prt);
}

// ===== CHECKBOX BULK =====
function toggleCheckAll(el) { document.querySelectorAll('.row-check').forEach(cb=>{ cb.checked=el.checked; }); updateBulkDeleteBtn(); }
function onRowCheck() {
  const all=document.querySelectorAll('.row-check'), checked=document.querySelectorAll('.row-check:checked');
  document.getElementById('checkAll').checked = all.length===checked.length && all.length>0;
  updateBulkDeleteBtn();
}
function updateBulkDeleteBtn() {
  const checked=document.querySelectorAll('.row-check:checked');
  const btn=document.getElementById('btnBulkDelete'), cnt=document.getElementById('selectedCount');
  if (checked.length>0) { btn.style.display='inline-flex'; cnt.textContent=checked.length; }
  else                  { btn.style.display='none'; }
}
function bulkDelete() {
  const checked=[...document.querySelectorAll('.row-check:checked')].map(cb=>cb.value);
  if (!checked.length) return;
  deleteBulkMode=true; deleteTargetId=checked;
  document.getElementById('deleteConfirmText').textContent=`Hapus ${checked.length} transaksi yang dipilih? Tindakan ini tidak dapat dibatalkan.`;
  document.getElementById('deleteOverlay').classList.add('open');
}

// ===== FILTER =====
function applyFilter() {
  const search=document.getElementById('filterSearch').value.toLowerCase();
  const date  =document.getElementById('filterDate').value;
  const month =document.getElementById('filterMonth').value;
  const jenis =document.getElementById('filterJenis').value;
  let base = viewMode==='today' ? transactions.filter(t=>t.datetime.startsWith(today())) : [...transactions];
  if (search) base=base.filter(t=>t.layanan.toLowerCase().includes(search)||t.jenis.toLowerCase().includes(search)||t.payment.toLowerCase().includes(search)||(t.keterangan||'').toLowerCase().includes(search));
  if (date)   base=base.filter(t=>t.datetime.startsWith(date));
  if (month)  base=base.filter(t=>t.datetime.startsWith(month));
  if (jenis)  base=base.filter(t=>t.jenis===jenis);
  renderHistory(base);
}
function clearFilter() {
  ['filterSearch','filterDate','filterMonth'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('filterJenis').value='';
  setViewMode(viewMode, true);
}

// ===== EDIT =====
function openEdit(id) {
  const t=transactions.find(x=>x.id===id); if (!t) return;
  document.getElementById('editId').value=id;
  document.getElementById('editJenis').value=t.jenis;
  updateEditLayanan();
  setTimeout(()=>{ document.getElementById('editLayanan').value=t.layanan; },0);
  document.getElementById('editJumlah').value=t.jumlah.toLocaleString('id-ID');
  document.getElementById('editKeterangan').value=t.keterangan||'';
  document.querySelector(`input[name="editPayment"][value="${t.payment}"]`).checked=true;
  document.getElementById('modalOverlay').classList.add('open');
}
function updateEditLayanan() {
  const jenis=document.getElementById('editJenis').value, sel=document.getElementById('editLayanan');
  sel.innerHTML='';
  (LAYANAN[jenis]||[]).forEach(l=>{ const o=document.createElement('option'); o.value=l; o.textContent=l; sel.appendChild(o); });
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }

async function updateTransaksi() {
  const id=document.getElementById('editId').value;
  const idx=transactions.findIndex(x=>x.id===id); if (idx===-1) return;
  transactions[idx].jenis      = document.getElementById('editJenis').value;
  transactions[idx].layanan    = document.getElementById('editLayanan').value;
  transactions[idx].jumlah     = parseRupiah(document.getElementById('editJumlah').value);
  transactions[idx].payment    = document.querySelector('input[name="editPayment"]:checked').value;
  transactions[idx].keterangan = document.getElementById('editKeterangan').value;
  closeModal();
  await gasUpdateTransaction(transactions[idx]);
  showToast('✅ Transaksi berhasil diperbarui!','success');
  applyFilter();
}

// ===== DELETE =====
function openDelete(id) {
  deleteBulkMode=false; deleteTargetId=id;
  document.getElementById('deleteConfirmText').textContent='Hapus transaksi ini? Tindakan tidak dapat dibatalkan.';
  document.getElementById('deleteOverlay').classList.add('open');
}
function closeDelete() { deleteTargetId=null; deleteBulkMode=false; document.getElementById('deleteOverlay').classList.remove('open'); }

async function confirmDelete() {
  if (!deleteTargetId) return;
  if (deleteBulkMode && Array.isArray(deleteTargetId)) {
    const ids=new Set(deleteTargetId), count=ids.size;
    transactions=transactions.filter(t=>!ids.has(t.id));
    closeDelete();
    await gasBulkDelete([...ids]);
    showToast(`🗑️ ${count} transaksi berhasil dihapus!`,'success');
  } else {
    transactions=transactions.filter(t=>t.id!==deleteTargetId);
    const id=deleteTargetId; closeDelete();
    await gasDeleteTransaction(id);
    showToast('🗑️ Transaksi berhasil dihapus!','success');
  }
  applyFilter();
}

// ===== DASHBOARD =====
function refreshDashboard() {
  const total=transactions.reduce((s,t)=>s+t.jumlah,0);
  const atk  =transactions.filter(t=>t.jenis==='ATK').reduce((s,t)=>s+t.jumlah,0);
  const prt  =transactions.filter(t=>t.jenis==='Print-Fotocopy').reduce((s,t)=>s+t.jumlah,0);
  const cnt  =transactions.filter(t=>t.datetime.startsWith(today())).length;
  document.getElementById('statTotal').textContent = rupiah(total);
  document.getElementById('statATK').textContent   = rupiah(atk);
  document.getElementById('statPrint').textContent = rupiah(prt);
  document.getElementById('statToday').textContent = cnt+' Transaksi';
  renderRecentTable();
  renderCharts();
}

function renderRecentTable() {
  const sorted=[...transactions].sort((a,b)=>new Date(b.datetime)-new Date(a.datetime)).slice(0,5);
  const tbody=document.getElementById('recentBody');
  if (!sorted.length) { tbody.innerHTML='<tr><td colspan="5" class="empty-state">Belum ada transaksi</td></tr>'; return; }
  tbody.innerHTML=sorted.map(t=>`
    <tr>
      <td style="font-size:12px">${fmtDateTime(t.datetime)}</td>
      <td><span class="badge ${t.jenis==='ATK'?'badge-atk':'badge-print'}">${t.jenis}</span></td>
      <td>${t.layanan}</td>
      <td style="font-weight:700">${rupiah(t.jumlah)}</td>
      <td><span class="badge ${t.payment==='Cash'?'badge-cash':'badge-transfer'}">${t.payment}</span></td>
    </tr>`).join('');
}

// ===== CHARTS =====
function destroyChart(k) { if (charts[k]) { charts[k].destroy(); charts[k]=null; } }
function isDark()        { return document.body.classList.contains('dark'); }
function tickColor()     { return isDark()?'#64748b':'#94a3b8'; }
function gridColor()     { return isDark()?'#1e293b':'#f1f5f9'; }
function renderCharts()  { renderHarianChart(); renderBulananChart(); renderDonutChart(); renderPaymentChart(); }

function scaleOpts() {
  return {
    x:{ grid:{display:false}, ticks:{font:{size:10},color:tickColor()} },
    y:{ grid:{color:gridColor()}, ticks:{font:{size:10},color:tickColor(),
      callback:v=>v>=1000000?(v/1000000).toFixed(1)+'jt':v>=1000?(v/1000).toFixed(0)+'rb':v} }
  };
}
function ttCb() { return { label: ctx=>' '+rupiah(ctx.raw) }; }

function renderHarianChart() {
  destroyChart('harian');
  const labels=[],atkD=[],prtD=[];
  for (let i=29;i>=0;i--) {
    const d=new Date(); d.setDate(d.getDate()-i);
    const ds=d.toISOString().split('T')[0];
    labels.push(d.getDate()+'/'+(d.getMonth()+1));
    const day=transactions.filter(t=>t.datetime.startsWith(ds));
    atkD.push(day.filter(t=>t.jenis==='ATK').reduce((s,t)=>s+t.jumlah,0));
    prtD.push(day.filter(t=>t.jenis==='Print-Fotocopy').reduce((s,t)=>s+t.jumlah,0));
  }
  charts.harian=new Chart(document.getElementById('chartHarian').getContext('2d'),{
    type:'bar',data:{labels,datasets:[
      {label:'ATK',data:atkD,backgroundColor:'rgba(22,163,74,.7)',borderRadius:4,barPercentage:.7},
      {label:'Print-Fotocopy',data:prtD,backgroundColor:'rgba(234,88,12,.7)',borderRadius:4,barPercentage:.7}
    ]},
    options:{responsive:true,maintainAspectRatio:true,
      plugins:{legend:{display:true,labels:{font:{size:11},boxWidth:12,color:tickColor()}},tooltip:{callbacks:ttCb()}},
      scales:scaleOpts()}
  });
}
function renderBulananChart() {
  destroyChart('bulanan');
  const now=new Date(),labels=[],data=[];
  for (let i=11;i>=0;i--) {
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    labels.push(BULAN[d.getMonth()]);
    data.push(transactions.filter(t=>t.datetime.startsWith(d.toISOString().substr(0,7))).reduce((s,t)=>s+t.jumlah,0));
  }
  const ctx=document.getElementById('chartBulanan').getContext('2d');
  const grad=ctx.createLinearGradient(0,0,0,200);
  grad.addColorStop(0,'rgba(37,99,235,.3)'); grad.addColorStop(1,'rgba(37,99,235,0)');
  charts.bulanan=new Chart(ctx,{type:'line',data:{labels,datasets:[{label:'Total',data,borderColor:'#2563eb',backgroundColor:grad,borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#2563eb',fill:true,tension:.4}]},
    options:{responsive:true,maintainAspectRatio:true,plugins:{legend:{display:false},tooltip:{callbacks:ttCb()}},scales:scaleOpts()}});
}
function donutCfg(labels,data,colors) {
  return {type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors,borderWidth:0,hoverOffset:4}]},
    options:{responsive:true,maintainAspectRatio:true,cutout:'65%',
      plugins:{legend:{position:'bottom',labels:{font:{size:11},boxWidth:12,color:tickColor()}},tooltip:{callbacks:ttCb()}}}};
}
function renderDonutChart() {
  destroyChart('donut');
  const atk=transactions.filter(t=>t.jenis==='ATK').reduce((s,t)=>s+t.jumlah,0);
  const prt=transactions.filter(t=>t.jenis==='Print-Fotocopy').reduce((s,t)=>s+t.jumlah,0);
  charts.donut=new Chart(document.getElementById('chartDonut').getContext('2d'),donutCfg(['ATK','Print-Fotocopy'],[atk||1,prt||1],['#16a34a','#ea580c']));
}
function renderPaymentChart() {
  destroyChart('payment');
  const csh=transactions.filter(t=>t.payment==='Cash').reduce((s,t)=>s+t.jumlah,0);
  const trf=transactions.filter(t=>t.payment==='Transfer').reduce((s,t)=>s+t.jumlah,0);
  charts.payment=new Chart(document.getElementById('chartPayment').getContext('2d'),donutCfg(['Cash','Transfer'],[csh||1,trf||1],['#2563eb','#7c3aed']));
}

// ===== EXPORT EXCEL =====
function exportExcel() {
  if (!filteredData.length) { alert('Tidak ada data untuk diekspor!'); return; }
  const sorted=[...filteredData].sort((a,b)=>new Date(b.datetime)-new Date(a.datetime));
  const rows=sorted.map((t,i)=>({'No':i+1,'Tanggal':fmtDateTime(t.datetime),'Jenis Transaksi':t.jenis,'Detail Layanan':t.layanan,'Jumlah (Rp)':t.jumlah,'Metode Pembayaran':t.payment,'Keterangan':t.keterangan||''}));
  const atk=filteredData.filter(t=>t.jenis==='ATK').reduce((s,t)=>s+t.jumlah,0);
  const prt=filteredData.filter(t=>t.jenis==='Print-Fotocopy').reduce((s,t)=>s+t.jumlah,0);
  const csh=filteredData.filter(t=>t.payment==='Cash').reduce((s,t)=>s+t.jumlah,0);
  const trf=filteredData.filter(t=>t.payment==='Transfer').reduce((s,t)=>s+t.jumlah,0);
  rows.push({},{'No':'REKAP','Jenis Transaksi':'Total ATK','Jumlah (Rp)':atk},
    {'Jenis Transaksi':'Total Print-Fotocopy','Jumlah (Rp)':prt},
    {'Jenis Transaksi':'Total Cash','Jumlah (Rp)':csh},
    {'Jenis Transaksi':'Total Transfer','Jumlah (Rp)':trf},
    {'Jenis Transaksi':'GRAND TOTAL','Jumlah (Rp)':atk+prt});
  const ws=XLSX.utils.json_to_sheet(rows);
  ws['!cols']=[{wch:5},{wch:20},{wch:18},{wch:22},{wch:14},{wch:18},{wch:28}];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Transaksi');
  XLSX.writeFile(wb,'Laporan_Kasir_ATK_'+today()+'.xlsx');
}

// ===== EXPORT PDF =====
function exportPDF() {
  if (!filteredData.length) { alert('Tidak ada data untuk diekspor!'); return; }
  const sorted=[...filteredData].sort((a,b)=>new Date(b.datetime)-new Date(a.datetime));
  const now=new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const atk=filteredData.filter(t=>t.jenis==='ATK').reduce((s,t)=>s+t.jumlah,0);
  const prt=filteredData.filter(t=>t.jenis==='Print-Fotocopy').reduce((s,t)=>s+t.jumlah,0);
  const csh=filteredData.filter(t=>t.payment==='Cash').reduce((s,t)=>s+t.jumlah,0);
  const trf=filteredData.filter(t=>t.payment==='Transfer').reduce((s,t)=>s+t.jumlah,0);
  const rows=sorted.map((t,i)=>`<tr><td>${i+1}</td><td>${fmtDateTime(t.datetime)}</td><td>${t.jenis}</td><td>${t.layanan}</td><td style="text-align:right">${rupiah(t.jumlah)}</td><td>${t.payment}</td><td>${t.keterangan||''}</td></tr>`).join('');
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Laporan Kasir</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;color:#222;padding:20px}h2{text-align:center;font-size:16px;margin-bottom:2px}.sub{text-align:center;font-size:11px;color:#666;margin-bottom:16px}table{width:100%;border-collapse:collapse;margin-bottom:16px}th{background:#1e3a5f;color:white;padding:8px;text-align:left;font-size:11px}td{padding:6px 8px;border-bottom:1px solid #eee;font-size:11px}tr:nth-child(even) td{background:#f8fafc}.grand{font-weight:bold;background:#1e3a5f!important;color:white}@media print{body{padding:0}}</style></head><body>
<h2>🖨️ Laporan Transaksi — Kasir ATK & Print-Fotocopy</h2>
<div class="sub">Dicetak: ${now} | ${sorted.length} transaksi</div>
<table><thead><tr><th>No</th><th>Tanggal</th><th>Jenis</th><th>Layanan</th><th>Jumlah</th><th>Pembayaran</th><th>Keterangan</th></tr></thead><tbody>${rows}</tbody></table>
<strong>📊 Rekap</strong><table style="margin-top:8px;width:360px">
<tr><td>Total ATK</td><td style="text-align:right;font-weight:600">${rupiah(atk)}</td></tr>
<tr><td>Total Print-Fotocopy</td><td style="text-align:right;font-weight:600">${rupiah(prt)}</td></tr>
<tr><td>Total Cash</td><td style="text-align:right;font-weight:600">${rupiah(csh)}</td></tr>
<tr><td>Total Transfer</td><td style="text-align:right;font-weight:600">${rupiah(trf)}</td></tr>
<tr class="grand"><td>GRAND TOTAL</td><td style="text-align:right">${rupiah(atk+prt)}</td></tr>
</table><script>window.onload=()=>window.print()<\/script></body></html>`;
  const w=window.open('','_blank'); w.document.write(html); w.document.close();
}

// ===== PRINT =====
function printLaporan() {
  document.getElementById('printSubtitle').textContent='Dicetak: '+new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+' | '+filteredData.length+' transaksi';
  document.querySelector('.print-header').style.display='block';
  window.print();
  document.querySelector('.print-header').style.display='none';
}

// ===== IMPORT EXCEL =====
function importExcel(input) {
  const file=input.files[0]; if (!file) return; input.value='';
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const wb=XLSX.read(e.target.result,{type:'binary'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const raw=XLSX.utils.sheet_to_json(ws,{defval:''});
      pendingImportData=[];
      const preview=[];
      raw.forEach((row,idx)=>{
        const tanggal=(row['Tanggal']||row['tanggal']||'').toString();
        const jenis=(row['Jenis Transaksi']||row['Jenis']||row['jenis']||'').toString().trim();
        const layanan=(row['Detail Layanan']||row['Layanan']||row['layanan']||'').toString().trim();
        const jumlah=parseRupiah(row['Jumlah (Rp)']||row['Jumlah']||row['jumlah']||0);
        const payment=(row['Metode Pembayaran']||row['Pembayaran']||row['pembayaran']||'Cash').toString().trim();
        const ket=(row['Keterangan']||row['keterangan']||'').toString().trim();
        if (!jenis||['REKAP','GRAND TOTAL','Total ATK','Total Print-Fotocopy','Total Cash','Total Transfer'].includes(jenis)) return;
        let status='ok',statusText='✅ Valid';
        if (!['ATK','Print-Fotocopy'].includes(jenis)) { status='warn'; statusText='⚠️ Jenis tidak dikenal'; }
        if (!jumlah) { status='err'; statusText='❌ Jumlah kosong'; }
        let dtIso=new Date().toISOString();
        if (tanggal) { const p=tanggal.split(' '), dp=p[0].split(/[\/\-]/), tp=p[1]||'00:00'; if(dp.length===3){const d=new Date(`${dp[2]}-${dp[1].padStart(2,'0')}-${dp[0].padStart(2,'0')}T${tp}:00`);if(!isNaN(d))dtIso=d.toISOString();} }
        preview.push({idx:idx+1,tanggal:tanggal||'Sekarang',jenis,layanan,jumlah,payment,ket,status,statusText});
        if (status!=='err') pendingImportData.push({id:genId(),no:0,datetime:dtIso,jenis,layanan,jumlah,payment,keterangan:ket});
      });
      if (!preview.length) { alert('Tidak ada data valid.'); return; }
      document.getElementById('importInfo').textContent=`Ditemukan ${preview.length} baris. ${pendingImportData.length} baris siap diimport.`;
      document.getElementById('importPreviewBody').innerHTML=preview.map(r=>`<tr><td>${r.idx}</td><td style="font-size:11px">${r.tanggal}</td><td>${r.jenis}</td><td>${r.layanan||'—'}</td><td>${rupiah(r.jumlah)}</td><td>${r.payment}</td><td style="font-size:11px">${r.ket||'—'}</td><td class="import-${r.status}">${r.statusText}</td></tr>`).join('');
      document.getElementById('importOverlay').classList.add('open');
    } catch(err) { alert('Gagal membaca file: '+err.message); }
  };
  reader.readAsBinaryString(file);
}
function closeImport() { pendingImportData=[]; document.getElementById('importOverlay').classList.remove('open'); }

async function confirmImport() {
  if (!pendingImportData.length) { closeImport(); return; }
  let nextN=nextNo();
  pendingImportData.forEach(t=>{ t.no=nextN++; });
  transactions.push(...pendingImportData);
  closeImport();
  await gasImport(pendingImportData);
  showToast(`✅ ${pendingImportData.length} transaksi berhasil diimport!`,'success');
  pendingImportData=[];
  applyFilter();
}

// ===== TEMPLATE =====
function downloadTemplate() {
  const rows=[
    {'Tanggal':'18/06/2025 09:30','Jenis Transaksi':'ATK','Detail Layanan':'Pulpen','Jumlah (Rp)':5000,'Metode Pembayaran':'Cash','Keterangan':'Contoh data'},
    {'Tanggal':'18/06/2025 10:00','Jenis Transaksi':'Print-Fotocopy','Detail Layanan':'Fotocopy Hitam Putih','Jumlah (Rp)':3000,'Metode Pembayaran':'Transfer','Keterangan':''},
  ];
  const ws=XLSX.utils.json_to_sheet(rows); ws['!cols']=[{wch:22},{wch:18},{wch:28},{wch:14},{wch:18},{wch:20}];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Template');
  XLSX.writeFile(wb,'Template_Import_Kasir.xlsx');
}

// ===== INIT =====
(async function init() {
  loadDarkMode();
  showLoadingOverlay(true);
  await loadData();
  showPage('dashboard');
})();

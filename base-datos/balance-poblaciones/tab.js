const COLS=['FECHA','COD_DISP','NOM_DISP','POBLA','COD_SEÑAL','CMD','CMES','OBS'];
const LABEL={FECHA:'Fecha',COD_DISP:'Código disp.',NOM_DISP:'Nombre dispositivo',POBLA:'Población',COD_SEÑAL:'Código señal',CMD:'CMD',CMES:'CMES',OBS:'Estado'};
let rows=[],filtered=[],page=1,editingId=null,changes=0,sortColumn='FECHA',sortDirection='asc';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const pad=n=>String(n).padStart(2,'0');
function excelDate(value){
 if(value==null||value==='')return '';
 if(value instanceof Date&&!Number.isNaN(value.getTime()))return `${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}`;
 if(typeof value==='number'){
  const o=XLSX.SSF.parse_date_code(value);
  return o?`${o.y}-${pad(o.m)}-${pad(o.d)}`:'';
 }
 const s=String(value).trim();
 let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;
 m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(m)return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
 return '';
}
const displayDate=v=>{const s=excelDate(v);return s?`${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`:''};
const num=v=>v==null||v===''?'':Number(v).toLocaleString('es-ES',{maximumFractionDigits:2});
function toast(t){$('toast').textContent=t;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2300)}
function dirty(){changes++;$('dirtyBadge').hidden=false;$('dirtyBadge').textContent=`${changes} cambio${changes===1?'':'s'}`}
function init(){
 $('headRow').innerHTML=COLS.map(c=>`<th><button class="sortButton" data-sort="${c}">${LABEL[c]} <span class="sortIcon">↕</span></button></th>`).join('')+'<th>Acciones</th>';$('headRow').querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>changeSort(b.dataset.sort));
 $('filterRow').innerHTML=COLS.map(c=>`<th><input data-col="${c}" placeholder="Filtrar..."></th>`).join('')+'<th></th>';
 $('filterRow').querySelectorAll('input').forEach(i=>i.oninput=()=>{page=1;applyFilters()});
 const ys=[...new Set(rows.map(r=>r.FECHA.slice(0,4)).filter(Boolean))].sort();
 $('yearFilter').innerHTML='<option value="">Todos</option>'+ys.map(y=>`<option>${y}</option>`).join('');
 $('monthFilter').innerHTML='<option value="">Todos</option>'+['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m,i)=>`<option value="${pad(i+1)}">${m}</option>`).join('');
}
function compareValues(a,b,column){let av=a[column]??'',bv=b[column]??'';if(column==='FECHA'){av=excelDate(av);bv=excelDate(bv)}else if(column==='CMD'||column==='CMES'){av=Number(av)||0;bv=Number(bv)||0}else{av=String(av).toLocaleLowerCase('es');bv=String(bv).toLocaleLowerCase('es')}return av<bv?-1:av>bv?1:0}
function changeSort(column){if(sortColumn===column)sortDirection=sortDirection==='asc'?'desc':'asc';else{sortColumn=column;sortDirection='asc'}page=1;applyFilters()}
function updateSortIcons(){$('headRow').querySelectorAll('[data-sort]').forEach(b=>{const icon=b.querySelector('.sortIcon');icon.textContent=b.dataset.sort===sortColumn?(sortDirection==='asc'?'▲':'▼'):'↕';b.classList.toggle('active',b.dataset.sort===sortColumn)})}
function applyFilters(){
 const y=$('yearFilter').value,m=$('monthFilter').value,g=$('globalFilter').value.trim().toLowerCase(),cf={};
 $('filterRow').querySelectorAll('input').forEach(i=>cf[i.dataset.col]=i.value.trim().toLowerCase());
 filtered=rows.filter(r=>(!y||r.FECHA.slice(0,4)===y)&&(!m||r.FECHA.slice(5,7)===m)&&(!g||COLS.some(c=>String(r[c]??'').toLowerCase().includes(g)))&&COLS.every(c=>!cf[c]||String(c==='FECHA'?displayDate(r[c]):r[c]??'').toLowerCase().includes(cf[c])));filtered.sort((a,b)=>compareValues(a,b,sortColumn)*(sortDirection==='asc'?1:-1));updateSortIcons();
 page=Math.min(page,Math.max(1,Math.ceil(filtered.length/+$('pageSize').value)));render();
}
function statusCell(r){
 if(!String(r.OBS??'').trim())return '<span class="statusBadge normal">Normal</span>';
 return `<span class="observationWrapper"><span class="statusBadge incident">Incidencia</span><span class="observationTooltip">${esc(r.OBS)}</span></span>`;
}
function render(){
 const size=+$('pageSize').value,start=(page-1)*size,list=filtered.slice(start,start+size);
 $('tableBody').innerHTML=list.map(r=>`<tr>${COLS.map(c=>c==='OBS'?`<td class="statusCell">${statusCell(r)}</td>`:c==='FECHA'?`<td>${displayDate(r[c])}</td>`:c==='CMD'||c==='CMES'?`<td>${num(r[c])}</td>`:`<td>${esc(r[c])}</td>`).join('')}<td class="actions"><button class="iconAction edit" onclick="openEdit(${r._id})" title="Editar registro" aria-label="Editar registro"><svg viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16v4zm12.5-16.5 4 4 1.5-1.5a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0L16.5 3.5z"/></svg></button><button class="iconAction delete" onclick="removeRow(${r._id})" title="Eliminar registro" aria-label="Eliminar registro"><svg viewBox="0 0 24 24"><path d="M7 21a2 2 0 0 1-2-2V6h14v13a2 2 0 0 1-2 2H7zm10-17h-3l-1-1h-2l-1 1H7v2h10V4z"/></svg></button></td></tr>`).join('')||'<tr><td colspan="9">Sin resultados</td></tr>';
 const pages=Math.max(1,Math.ceil(filtered.length/size));$('rowCount').textContent=`${filtered.length.toLocaleString('es-ES')} registros`;$('pageInfo').textContent=`Página ${page} de ${pages}`;$('prevPage').disabled=page<=1;$('nextPage').disabled=page>=pages;
}
function openEdit(id){editingId=id;const r=id==null?{FECHA:`${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}-${pad(new Date().getDate())}`,CMD:0,CMES:0}:rows.find(x=>x._id===id);$('modalTitle').textContent=id==null?'Añadir registro':'Editar registro';$('editFields').innerHTML=COLS.map(c=>`<label class="${c==='OBS'?'full':''}">${c==='OBS'?'Observación':LABEL[c]}${c==='OBS'?`<textarea name="${c}">${esc(r[c])}</textarea>`:`<input name="${c}" type="${c==='FECHA'?'date':c==='CMD'||c==='CMES'?'number':'text'}" step="any" value="${esc(r[c])}">`}</label>`).join('');$('editDialog').showModal()}
function saveEdit(e){e.preventDefault();const fd=new FormData($('editDialog').querySelector('form')),o={};COLS.forEach(c=>o[c]=c==='CMD'||c==='CMES'?Number(fd.get(c)||0):String(fd.get(c)??'').trim());o.FECHA=excelDate(o.FECHA);if(!o.FECHA)return toast('La fecha es obligatoria');if(editingId==null){o._id=Math.max(0,...rows.map(r=>r._id))+1;rows.unshift(o)}else Object.assign(rows.find(r=>r._id===editingId),o);$('editDialog').close();dirty();applyFilters();toast('Registro guardado')}
function removeRow(id){const r=rows.find(x=>x._id===id);if(!confirm(`¿Eliminar ${r.COD_DISP||'este registro'}?`))return;rows=rows.filter(x=>x._id!==id);dirty();applyFilters();toast('Registro eliminado')}
function saveExcel(){const data=rows.map(r=>Object.fromEntries(COLS.map(c=>[c,c==='FECHA'?(()=>{const [y,m,d]=r.FECHA.split('-').map(Number);return new Date(y,m-1,d)})():r[c]])));const ws=XLSX.utils.json_to_sheet(data,{header:COLS,cellDates:true,dateNF:'dd/mm/yyyy'});ws['!cols']=[{wch:12},{wch:16},{wch:38},{wch:30},{wch:20},{wch:15},{wch:15},{wch:55}];for(let i=2;i<=rows.length+1;i++)if(ws[`A${i}`])ws[`A${i}`].z='dd/mm/yyyy';const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Balance_Pobla');XLSX.writeFile(wb,'BD_Balance_Poblaciones_modificado.xlsx',{compression:true,cellDates:true});toast('Excel descargado')}
async function loadDatabase(){try{const response=await fetch('balance-poblaciones/BD_Balance_Poblaciones.xlsx',{cache:'no-store'});if(!response.ok)throw Error(`HTTP ${response.status}`);const workbook=XLSX.read(await response.arrayBuffer(),{type:'array',cellDates:true});const sheet=workbook.Sheets['Balance_Pobla']||workbook.Sheets[workbook.SheetNames[0]];rows=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:true}).map((r,i)=>({_id:i+1,FECHA:excelDate(r.FECHA),COD_DISP:r.COD_DISP??'',NOM_DISP:r.NOM_DISP??'',POBLA:r.POBLA??'',COD_SEÑAL:r['COD_SEÑAL']??'',CMD:Number(r.CMD||0),CMES:Number(r.CMES||0),OBS:r.OBS??''}));init();applyFilters()}catch(e){console.error(e);$('rowCount').textContent='No se pudo abrir el Excel';toast('Error cargando BD_Balance_Poblaciones.xlsx')}}
window.openEdit=openEdit;window.removeRow=removeRow;$('confirmEdit').onclick=saveEdit;$('addRow').onclick=()=>openEdit(null);$('saveExcel').onclick=saveExcel;['yearFilter','monthFilter'].forEach(id=>$(id).onchange=()=>{page=1;applyFilters()});$('globalFilter').oninput=()=>{page=1;applyFilters()};$('pageSize').onchange=()=>{page=1;applyFilters()};$('prevPage').onclick=()=>{page--;render()};$('nextPage').onclick=()=>{page++;render()};$('clearFilters').onclick=()=>{$('yearFilter').value='';$('monthFilter').value='';$('globalFilter').value='';$('filterRow').querySelectorAll('input').forEach(i=>i.value='');page=1;applyFilters()};loadDatabase();

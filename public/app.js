(() => {
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const routes = [
{id:"01",name:"North Campus Loop",driver:"Meera Nair",vehicle:"KL 07 AB 1042",students:34,eta:"8 min",status:"On route"},
{id:"03",name:"Oak Street Route",driver:"Rahul Das",vehicle:"KL 07 CD 2081",students:31,eta:"4 min",status:"On schedule"},
{id:"06",name:"Riverside Express",driver:"Sanjay Kumar",vehicle:"KL 07 EF 3319",students:29,eta:"12 min",status:"Running late"},
{id:"02",name:"East Gate Route",driver:"Anitha Joseph",vehicle:"KL 07 GH 4408",students:28,eta:"6 min",status:"On route"},
{id:"05",name:"Market Road Loop",driver:"Biju Thomas",vehicle:"KL 07 JK 5620",students:32,eta:"10 min",status:"On route"},
{id:"08",name:"Hillview Route",driver:"Vivek Menon",vehicle:"KL 07 LM 6871",students:27,eta:"—",status:"Signal unavailable"}
];
const students = [
{id:"ST-104",name:"Aarav Menon",grade:"Grade 2 · A",route:"03",status:"Present"},
{id:"ST-108",name:"Diya Thomas",grade:"Grade 3 · B",route:"01",status:"Present"},
{id:"ST-112",name:"Ishaan Nair",grade:"Grade 1 · A",route:"06",status:"Not marked"},
{id:"ST-116",name:"Mira Joseph",grade:"Grade 4 · A",route:"03",status:"Absent"},
{id:"ST-121",name:"Neha Varghese",grade:"Grade 2 · C",route:"02",status:"Present"},
{id:"ST-127",name:"Rohan Das",grade:"Grade 5 · B",route:"05",status:"Not marked"},
{id:"ST-132",name:"Sara Mathew",grade:"Grade 1 · C",route:"01",status:"Present"},
{id:"ST-139",name:"Vihaan Paul",grade:"Grade 3 · A",route:"06",status:"Not marked"}
];
const activity = [
{icon:"✓",title:"Attendance synced",body:"Route 01 · 28 of 34 students marked present.",time:"8:42 AM"},
{icon:"↗",title:"Parent alert prepared",body:"Van 03 is approaching Oak Street (demo).",time:"8:39 AM"},
{icon:"!",title:"Route delay reported",body:"Riverside Express is running about 6 minutes late.",time:"8:35 AM"},
{icon:"⌖",title:"Location updated",body:"Van 02 shared a sample location.",time:"8:31 AM"}
];
let currentView="overview", searchText="", attendanceFilter="All", toastTimer;
$("#todayDate").textContent=new Date().toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"});
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.remove("hidden");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add("hidden"),2800);}
function modal(html){$("#modalContent").innerHTML=html;$("#modal").classList.remove("hidden");}
function closeModal(){$("#modal").classList.add("hidden");}
function pill(status){return '<span class="status-pill '+((status==="Absent"||status==="Not marked"||status==="Running late"||status==="Signal unavailable")?"delayed":"")+'">'+status+'</span>';}
function activityHtml(a){return '<div class="activity-row"><div class="activity-icon '+(a.title.indexOf("delay")>=0?"warn":"")+'">'+a.icon+'</div><div class="activity-copy"><strong>'+a.title+'</strong><p>'+a.body+'</p><time>'+a.time+'</time></div></div>';}
function routeHtml(r){return '<div class="route-row"><div class="van-icon">🚐</div><div class="route-info"><strong>Van '+r.id+' · '+r.name+'</strong><small>'+r.driver+' · '+r.students+' students</small></div><div class="route-status">'+pill(r.status)+'<small>'+r.eta+' to next stop</small></div></div>';}
$("#routeList").innerHTML=routes.slice(0,3).map(routeHtml).join("");
$("#activityList").innerHTML=activity.slice(0,3).map(activityHtml).join("");
function switchView(view){
currentView=view;
["overview","tracking","attendance","students"].forEach(v=>{const el=$("#"+v+"View");if(el)el.classList.toggle("hidden",v!==view);});
$$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
const labels={overview:"Overview",tracking:"Live tracking",attendance:"Attendance",students:"Students"};
$("#crumbTitle").textContent=labels[view];
const titles={overview:'Good morning, Alex <span>✳</span>',tracking:"Your fleet, at a glance",attendance:"Every student accounted for",students:"Student directory"};
const subtitles={overview:"Here's what's happening across your school routes today.",tracking:"Explore vehicle assignments and illustrative arrival estimates.",attendance:"Review and update the sample morning pickup register.",students:"Browse sample students assigned to school routes."};
$("#pageTitle").innerHTML=titles[view];$("#pageSubtitle").textContent=subtitles[view];
$("#shareBtn").textContent=view==="attendance"?"Export attendance":view==="tracking"?"Share route update":"Share parent update";
$("#notice").classList.add("hidden");
if(view==="tracking")renderTracking();if(view==="attendance")renderAttendance();if(view==="students")renderStudents();
}
function renderTracking(){
$("#trackingView").innerHTML='<div class="panel view-panel"><div class="panel-head"><div><h2>Fleet tracking</h2><p>Illustrative vehicle positions and estimated arrivals.</p></div><span class="status-pill">DEMO MODE</span></div><div class="toolbar"><div class="toolbar-left"><input class="search-field" id="routeSearch" placeholder="Search route, driver or vehicle…"></div><div class="toolbar-right"><button class="secondary-btn" id="refreshRoutes">↻ Refresh demo data</button></div></div><div class="table-wrap"><table><thead><tr><th>VEHICLE / ROUTE</th><th>DRIVER</th><th>STUDENTS</th><th>NEXT ARRIVAL</th><th>STATUS</th><th></th></tr></thead><tbody id="routeTable"></tbody></table></div><div class="notice" style="margin-top:15px;margin-bottom:0">These are sample positions, not live GPS coordinates. Real tracking needs a driver app or GPS provider.</div></div>';
function draw(){const q=($("#routeSearch").value||"").toLowerCase();const list=routes.filter(r=>([r.name,r.driver,r.vehicle,r.id].join(" ")).toLowerCase().includes(q));$("#routeTable").innerHTML=list.map(r=>'<tr><td><div class="student-cell"><span class="van-icon">🚐</span><span><strong>Van '+r.id+' · '+r.name+'</strong><small>'+r.vehicle+'</small></span></div></td><td>'+r.driver+'</td><td>'+r.students+'</td><td>'+r.eta+'</td><td>'+pill(r.status)+'</td><td><button class="small-btn" data-route="'+r.id+'">Details</button></td></tr>').join("")||'<tr><td colspan="6" class="empty-state">No routes match your search.</td></tr>';}
draw();$("#routeSearch").addEventListener("input",draw);$("#refreshRoutes").addEventListener("click",()=>toast("Demo route list refreshed."));
$("#routeTable").addEventListener("click",e=>{const b=e.target.closest("[data-route]");if(!b)return;const r=routes.find(x=>x.id===b.dataset.route);modal('<div class="eyebrow">VEHICLE DETAILS · DEMO</div><h2>Van '+r.id+' · '+r.name+'</h2><p>Sample fleet information. Live location is not connected yet.</p><div class="form-row"><label>Assigned driver</label><div>'+r.driver+'</div></div><div class="form-row"><label>Vehicle registration</label><div>'+r.vehicle+'</div></div><div class="form-row"><label>Students assigned</label><div>'+r.students+'</div></div><div class="form-row"><label>Next stop estimate</label><div>'+r.eta+'</div></div><button class="primary-btn" id="modalDone">Done</button>');$("#modalDone").onclick=closeModal;});
}
function studentRow(s,action){return '<tr><td><div class="student-cell"><span class="student-avatar">'+s.name.split(" ").map(x=>x[0]).slice(0,2).join("")+'</span><span><strong>'+s.name+'</strong><small>'+s.id+'</small></span></div></td><td>'+s.grade+'</td><td>Route '+s.route+'</td><td>'+pill(s.status)+'</td>'+(action?'<td><button class="mark-btn '+(s.status!=="Not marked"?"marked":"")+'" data-mark="'+s.id+'">'+(s.status==="Not marked"?"Mark present":"Update")+'</button></td>':'')+'</tr>';}
function renderAttendance(){
$("#attendanceView").innerHTML='<div class="panel view-panel"><div class="panel-head"><div><h2>Today’s attendance</h2><p>Sample student register for the morning pickup.</p></div><span class="status-pill">DEMO DATA</span></div><div class="toolbar"><div class="toolbar-left"><input class="search-field" id="studentSearch" placeholder="Search student or route…"><select class="select-field" id="attendanceFilter"><option>All</option><option>Present</option><option>Absent</option><option>Not marked</option></select></div><div class="toolbar-right"><button class="secondary-btn" id="resetAttendance">Reset demo attendance</button></div></div><div class="table-wrap"><table><thead><tr><th>STUDENT</th><th>CLASS</th><th>ROUTE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody id="studentTable"></tbody></table></div><div class="notice" style="margin-top:15px;margin-bottom:0">Demo changes remain in this browser session and are not saved to a school database.</div></div>';
$("#attendanceFilter").value=attendanceFilter;
function draw(){const q=($("#studentSearch").value||"").toLowerCase();const list=students.filter(s=>(attendanceFilter==="All"||s.status===attendanceFilter)&&[s.name,s.id,s.grade,s.route].join(" ").toLowerCase().includes(q));$("#studentTable").innerHTML=list.map(s=>studentRow(s,true)).join("")||'<tr><td colspan="5" class="empty-state">No students match your filters.</td></tr>';}
draw();$("#studentSearch").addEventListener("input",draw);$("#attendanceFilter").addEventListener("change",e=>{attendanceFilter=e.target.value;draw();});
$("#studentTable").addEventListener("click",e=>{const b=e.target.closest("[data-mark]");if(!b)return;const s=students.find(x=>x.id===b.dataset.mark);s.status=s.status==="Present"?"Absent":"Present";draw();toast(s.name+" marked "+s.status.toLowerCase()+" (demo only).");});
$("#resetAttendance").addEventListener("click",()=>{students.forEach(s=>s.status="Not marked");attendanceFilter="All";renderAttendance();toast("Demo attendance reset.");});
}
function renderStudents(){
$("#studentsView").innerHTML='<div class="panel view-panel"><div class="panel-head"><div><h2>Student directory</h2><p>Example students and assigned school routes.</p></div><span class="status-pill">SAMPLE RECORDS</span></div><div class="toolbar"><div class="toolbar-left"><input class="search-field" id="directorySearch" placeholder="Search student, class or route…"></div><div class="toolbar-right"><button class="primary-btn" id="addStudent">＋ Add demo student</button></div></div><div class="table-wrap"><table><thead><tr><th>STUDENT</th><th>CLASS</th><th>ROUTE</th><th>TODAY</th></tr></thead><tbody id="directoryTable"></tbody></table></div><div class="notice" style="margin-top:15px;margin-bottom:0">These are sample records. Add school authentication and secure persistent storage before using real student data.</div></div>';
function draw(){const q=($("#directorySearch").value||"").toLowerCase();const list=students.filter(s=>[s.name,s.id,s.grade,s.route].join(" ").toLowerCase().includes(q));$("#directoryTable").innerHTML=list.map(s=>studentRow(s,false)).join("")||'<tr><td colspan="4" class="empty-state">No students match your search.</td></tr>';}
draw();$("#directorySearch").addEventListener("input",draw);
$("#addStudent").addEventListener("click",()=>{modal('<div class="eyebrow">DEMO WORKSPACE</div><h2>Add a sample student</h2><p>This adds a temporary example to this page only.</p><form id="studentForm"><div class="form-row"><label for="newName">Student name</label><input id="newName" required maxlength="80" placeholder="e.g. Anaya Kumar"></div><div class="form-row"><label for="newGrade">Class</label><select id="newGrade"><option>Grade 1 · A</option><option>Grade 2 · A</option><option>Grade 3 · B</option><option>Grade 4 · A</option><option>Grade 5 · B</option></select></div><div class="form-row"><label for="newRoute">Route</label><select id="newRoute">'+routes.map(r=>'<option value="'+r.id+'">Route '+r.id+'</option>').join("")+'</select></div><button class="primary-btn" type="submit">Add sample record</button></form>');$("#studentForm").onsubmit=e=>{e.preventDefault();const name=$("#newName").value.trim();if(!name)return;students.push({id:"ST-"+(140+students.length),name:name,grade:$("#newGrade").value,route:$("#newRoute").value,status:"Not marked"});closeModal();renderStudents();toast("Sample student added for this session.");};});
}
$$(".nav-item").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
$$("[data-goto]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.goto)));
$("#closeModal").addEventListener("click",closeModal);$("#modal").addEventListener("click",e=>{if(e.target.id==="modal")closeModal();});document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
$("#shareBtn").addEventListener("click",()=>{
if(currentView==="attendance"){const csv=["Student ID,Name,Class,Route,Status"].concat(students.map(s=>[s.id,'"'+s.name.replace(/"/g,'""')+'"','"'+s.grade+'"',s.route,s.status].join(","))).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="school-van-demo-attendance.csv";a.click();URL.revokeObjectURL(a.href);toast("Demo attendance CSV exported.");return;}
modal('<div class="eyebrow">PARENT COMMUNICATION</div><h2>Share a school update</h2><p>Preview a message for parents. This demo does not send WhatsApp, SMS, or push notifications.</p><div class="form-row"><label for="updateMessage">Message</label><textarea id="updateMessage">Good morning! School transport is running. Please use the school’s official channel for confirmed arrival updates.</textarea></div><button class="primary-btn" id="copyUpdate">Copy message</button>');$("#copyUpdate").onclick=async()=>{try{await navigator.clipboard.writeText($("#updateMessage").value);toast("Message copied.");closeModal();}catch(e){toast("Select and copy the message manually.");}};
});
$("#bellBtn").addEventListener("click",()=>{modal('<div class="eyebrow">NOTIFICATIONS · DEMO</div><h2>Recent transport updates</h2><p>Example alerts for this sample workspace.</p>'+activity.map(activityHtml).join("")+'<button class="primary-btn" id="notifDone">Done</button>');$("#notifDone").onclick=closeModal;});
$("#helpBtn").addEventListener("click",()=>{modal('<div class="eyebrow">SUPPORT</div><h2>Need a hand?</h2><p>A support mailbox is not configured in this demo. Add the school’s support contact before launch.</p><button class="primary-btn" id="supportDone">Done</button>');$("#supportDone").onclick=closeModal;});
$("#activityMenu").addEventListener("click",()=>toast("Activity menu is a demo control."));
$("#allActivity").addEventListener("click",()=>{modal('<div class="eyebrow">ACTIVITY LOG · DEMO</div><h2>Recent activity</h2>'+activity.map(activityHtml).join("")+'<button class="primary-btn" id="activityDone">Close log</button>');$("#activityDone").onclick=closeModal;});
})();
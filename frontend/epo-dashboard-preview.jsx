import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from "recharts";
import { Search, Bell, ChevronDown, Plus, Clock, CheckCircle, XCircle, AlertTriangle, Mail, FileSpreadsheet, Settings, LayoutDashboard, FileText, Users, TrendingUp, RefreshCw, Download, Eye, Send, Zap, DollarSign, ArrowUpRight, ArrowDownRight } from "lucide-react";

/*
  DESIGN SYSTEM — derived from skylit.ai
  Font: DM Sans (via Google Fonts CDN loaded in Tailwind)
  Mono: Roboto Mono for numeric data
  Palette: near-black surfaces, white-alpha text, green/amber/red accents
*/

const T = {
  bg:       "#0a0a0a",
  surface:  "rgba(255,255,255,0.04)",
  card:     "rgba(255,255,255,0.06)",
  border:   "rgba(255,255,255,0.08)",
  borderLt: "rgba(255,255,255,0.12)",
  text1:    "rgba(255,255,255,0.85)",
  text2:    "rgba(255,255,255,0.50)",
  text3:    "rgba(255,255,255,0.30)",
  white:    "#ffffff",
  black:    "#000000",
  green:    "rgb(52,211,153)",
  greenDim: "rgba(52,211,153,0.12)",
  greenBdr: "rgba(52,211,153,0.25)",
  amber:    "rgb(251,191,36)",
  amberDim: "rgba(251,191,36,0.12)",
  amberBdr: "rgba(251,191,36,0.25)",
  red:      "rgb(248,113,113)",
  redDim:   "rgba(248,113,113,0.12)",
  redBdr:   "rgba(248,113,113,0.25)",
  blue:     "rgb(144,191,249)",
  blueDim:  "rgba(144,191,249,0.10)",
  blueBdr:  "rgba(144,191,249,0.20)",
  purple:   "rgb(192,160,255)",
  purpleDim:"rgba(192,160,255,0.10)",
  purpleBdr:"rgba(192,160,255,0.20)",
};

const font = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const mono = "'Roboto Mono', 'SF Mono', 'Fira Code', monospace";

// ─── DATA ──────────────────────────────────────────────
const epos = [
  { id:1, vendor:"Summit Builders", community:"Odell Park", lot:"142", desc:"Touch-up paint after drywall repair, master bedroom ceiling", amount:285, status:"pending", date:"Apr 2", days:1, conf:"" },
  { id:2, vendor:"Pulte Homes", community:"Mallard Park", lot:"67", desc:"Extra coat exterior trim - color mismatch from original spec", amount:450, status:"confirmed", date:"Mar 28", days:6, conf:"PO-4421" },
  { id:3, vendor:"DRB Homes", community:"Galloway", lot:"33", desc:"Ceiling repair and repaint after plumbing leak in unit 3B", amount:720, status:"pending", date:"Mar 25", days:9, conf:"" },
  { id:4, vendor:"Summit Builders", community:"Olmsted", lot:"15", desc:"Garage floor paint - wrong color applied by sub crew", amount:380, status:"denied", date:"Mar 20", days:14, conf:"" },
  { id:5, vendor:"Pulte Homes", community:"Ridgeview", lot:"88", desc:"Accent wall repaint - homeowner change order post-walkthrough", amount:165, status:"confirmed", date:"Mar 18", days:16, conf:"PO-4398" },
  { id:6, vendor:"K. Hovnanian", community:"Cedar Hills", lot:"201", desc:"Exterior siding paint correction on south-facing elevation", amount:890, status:"pending", date:"Mar 30", days:4, conf:"" },
  { id:7, vendor:"DRB Homes", community:"Odell Park", lot:"156", desc:"Bathroom vanity area moisture damage repaint", amount:210, status:"discount", date:"Mar 22", days:12, conf:"" },
  { id:8, vendor:"Pulte Homes", community:"Mallard Park", lot:"71", desc:"Stairwell scuff repair from move-in damage", amount:195, status:"confirmed", date:"Apr 1", days:2, conf:"PO-4455" },
];

const monthly = [
  { m:"Nov", total:12, confirmed:8, value:4200 },
  { m:"Dec", total:18, confirmed:14, value:6800 },
  { m:"Jan", total:22, confirmed:16, value:8100 },
  { m:"Feb", total:15, confirmed:11, value:5400 },
  { m:"Mar", total:28, confirmed:21, value:11200 },
  { m:"Apr", total:8, confirmed:3, value:3295 },
];

const statusMap = {
  pending:   { label:"Pending",   color:T.amber,  dim:T.amberDim,  bdr:T.amberBdr },
  confirmed: { label:"Confirmed", color:T.green,   dim:T.greenDim,  bdr:T.greenBdr },
  denied:    { label:"Denied",    color:T.red,     dim:T.redDim,    bdr:T.redBdr },
  discount:  { label:"Discount",  color:T.purple,  dim:T.purpleDim, bdr:T.purpleBdr },
};

// ─── PRIMITIVES ────────────────────────────────────────
const Label = ({ children, style }) => (
  <span style={{ fontFamily: font, fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: T.text3, ...style }}>{children}</span>
);

const Num = ({ children, style }) => (
  <span style={{ fontFamily: mono, fontWeight: 500, ...style }}>{children}</span>
);

const Dot = ({ color, size = 6 }) => (
  <span style={{ width: size, height: size, borderRadius: size, background: color, display: "inline-block", flexShrink: 0 }} />
);

const Badge = ({ status }) => {
  const s = statusMap[status];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 9px", borderRadius:6, fontSize:11, fontWeight:500, fontFamily:font, color:s.color, background:s.dim, border:`1px solid ${s.bdr}` }}>
      <Dot color={s.color} size={5} />
      {s.label}
    </span>
  );
};

const Btn = ({ children, primary, small, style, ...props }) => (
  <button style={{
    display:"inline-flex", alignItems:"center", gap:6,
    padding: small ? "5px 10px" : "8px 16px",
    borderRadius: 10, border: primary ? "none" : `1px solid ${T.border}`,
    background: primary ? T.white : "transparent",
    color: primary ? T.black : T.text2,
    fontSize: small ? 12 : 13, fontWeight: primary ? 600 : 450, fontFamily: font,
    cursor:"pointer", letterSpacing: primary ? "0.02em" : 0,
    transition: "border-color 0.15s, color 0.15s",
    ...style,
  }} {...props}>{children}</button>
);

const Card = ({ children, style, glow }) => (
  <div style={{
    background: T.card, border: `1px solid ${glow || T.border}`,
    borderRadius: 12, padding: 20, backdropFilter: "blur(4px)",
    ...style,
  }}>{children}</div>
);

// ─── SIDEBAR ───────────────────────────────────────────
function Sidebar({ page, setPage }) {
  const items = [
    { id:"dash", icon:LayoutDashboard, label:"Dashboard" },
    { id:"epos", icon:FileText, label:"EPOs" },
    { id:"analytics", icon:TrendingUp, label:"Analytics" },
    { id:"team", icon:Users, label:"Team" },
    { id:"connect", icon:Zap, label:"Integrations" },
    { id:"settings", icon:Settings, label:"Settings" },
  ];
  return (
    <div style={{ width:220, background:T.bg, borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", padding:"20px 10px", fontFamily:font }}>
      {/* Brand */}
      <div style={{ padding:"2px 12px 28px", display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:28, height:28, borderRadius:8, background:T.card, border:`1px solid ${T.borderLt}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <FileText size={14} color={T.text2} />
        </div>
        <span style={{ fontSize:15, fontWeight:600, color:T.text1, letterSpacing:"-0.03em" }}>EPO Tracker</span>
      </div>
      {/* Nav */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:1 }}>
        {items.map(it => {
          const active = page === it.id;
          const Icon = it.icon;
          return (
            <button key={it.id} onClick={() => setPage(it.id)} style={{
              display:"flex", alignItems:"center", gap:9, padding:"9px 12px", borderRadius:8,
              border:"none", cursor:"pointer", fontSize:13, fontWeight: active ? 500 : 400,
              fontFamily:font, background: active ? T.card : "transparent",
              color: active ? T.text1 : T.text3,
              transition:"all 0.12s",
            }}>
              <Icon size={16} strokeWidth={active ? 2 : 1.5} />
              {it.label}
            </button>
          );
        })}
      </div>
      {/* User */}
      <div style={{ padding:"14px 12px 4px", borderTop:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:9 }}>
        <div style={{ width:28, height:28, borderRadius:7, background:"rgba(52,211,153,0.15)", border:`1px solid ${T.greenBdr}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:600, color:T.green, fontFamily:font }}>G</div>
        <div>
          <div style={{ fontSize:12, fontWeight:500, color:T.text1 }}>Gabriel Jordao</div>
          <div style={{ fontSize:10, color:T.text3 }}>Stancil Services</div>
        </div>
      </div>
    </div>
  );
}

// ─── TOPBAR ────────────────────────────────────────────
function Topbar() {
  return (
    <div style={{ height:52, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 24px", fontFamily:font }}>
      <div style={{ position:"relative" }}>
        <Search size={14} style={{ position:"absolute", left:10, top:9, color:T.text3 }} />
        <input placeholder="Search EPOs, vendors..." style={{
          padding:"7px 12px 7px 32px", borderRadius:8, border:`1px solid ${T.border}`,
          background:"transparent", color:T.text1, fontSize:12, fontFamily:font,
          outline:"none", width:260,
        }} />
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
        <Dot color={T.green} size={7} />
        <span style={{ fontSize:11, color:T.text3 }}>Email sync active</span>
        <div style={{ width:1, height:20, background:T.border }} />
        <button style={{ position:"relative", background:"none", border:"none", cursor:"pointer", padding:4 }}>
          <Bell size={16} color={T.text3} />
          <span style={{ position:"absolute", top:2, right:2, width:5, height:5, borderRadius:5, background:T.amber }} />
        </button>
      </div>
    </div>
  );
}

// ─── DASHBOARD PAGE ────────────────────────────────────
function DashPage() {
  const total = epos.length;
  const confirmed = epos.filter(e => e.status === "confirmed").length;
  const pending = epos.filter(e => e.status === "pending").length;
  const totalVal = epos.reduce((s,e) => s + e.amount, 0);
  const rate = Math.round(confirmed / total * 100);
  const needsFollowup = epos.filter(e => e.status === "pending" && e.days >= 4).length;

  const metrics = [
    { label:"Total EPOs", value:total, change:"+18%", up:true },
    { label:"Capture Rate", value:`${rate}%`, change:"+5pt", up:true },
    { label:"Total Value", value:`$${totalVal.toLocaleString()}`, change:"+$2.1k", up:true },
    { label:"Needs Follow-Up", value:needsFollowup, change:"-2", up:false },
  ];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:500, color:T.text1, margin:0, letterSpacing:"-0.04em", fontFamily:font }}>Dashboard</h1>
          <span style={{ fontSize:12, color:T.text3, fontFamily:font }}>Week of April 3, 2026</span>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <Btn><Download size={14} /> Export</Btn>
          <Btn primary><Plus size={14} /> New EPO</Btn>
        </div>
      </div>

      {/* Metrics row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
        {metrics.map((m,i) => (
          <Card key={i} style={{ padding:"16px 18px" }}>
            <Label>{m.label}</Label>
            <div style={{ display:"flex", alignItems:"baseline", gap:8, marginTop:8 }}>
              <Num style={{ fontSize:24, color:T.text1, letterSpacing:"-0.03em" }}>{m.value}</Num>
              <span style={{ fontSize:11, fontFamily:mono, color: m.up ? T.green : T.red, display:"flex", alignItems:"center", gap:2 }}>
                {m.up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                {m.change}
              </span>
            </div>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display:"grid", gridTemplateColumns:"3fr 2fr", gap:12, marginBottom:24 }}>
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div>
              <div style={{ fontSize:13, fontWeight:500, color:T.text1, fontFamily:font }}>Revenue Trend</div>
              <Label style={{ marginTop:2 }}>Last 6 months</Label>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={monthly}>
              <defs>
                <linearGradient id="gVal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.green} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={T.green} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={T.border} strokeDasharray="3 3" />
              <XAxis dataKey="m" tick={{ fontSize:10, fill:T.text3, fontFamily:mono }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:10, fill:T.text3, fontFamily:mono }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background:"#141414", border:`1px solid ${T.border}`, borderRadius:8, fontSize:12, fontFamily:mono, color:T.text1 }} />
              <Area type="monotone" dataKey="value" stroke={T.green} strokeWidth={1.5} fill="url(#gVal)" name="Revenue" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <div style={{ fontSize:13, fontWeight:500, color:T.text1, fontFamily:font, marginBottom:4 }}>Status Breakdown</div>
          <Label>Current quarter</Label>
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:20 }}>
            {[
              { label:"Confirmed", count:confirmed, total, color:T.green },
              { label:"Pending", count:pending, total, color:T.amber },
              { label:"Denied", count:epos.filter(e=>e.status==="denied").length, total, color:T.red },
              { label:"Discount", count:epos.filter(e=>e.status==="discount").length, total, color:T.purple },
            ].map((s,i) => {
              const pct = Math.round(s.count / s.total * 100);
              return (
                <div key={i}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <Dot color={s.color} />
                      <span style={{ fontSize:12, color:T.text2, fontFamily:font }}>{s.label}</span>
                    </div>
                    <Num style={{ fontSize:12, color:T.text2 }}>{s.count} <span style={{ color:T.text3 }}>({pct}%)</span></Num>
                  </div>
                  <div style={{ height:3, borderRadius:2, background:T.surface }}>
                    <div style={{ height:"100%", borderRadius:2, background:s.color, width:`${pct}%`, opacity:0.7, transition:"width 0.4s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Volume chart */}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:500, color:T.text1, fontFamily:font }}>Monthly Volume</div>
            <Label style={{ marginTop:2 }}>EPOs submitted vs confirmed</Label>
          </div>
          <div style={{ display:"flex", gap:14 }}>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}><Dot color={T.text3} /><span style={{ fontSize:11, color:T.text3, fontFamily:font }}>Submitted</span></div>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}><Dot color={T.green} /><span style={{ fontSize:11, color:T.text3, fontFamily:font }}>Confirmed</span></div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={monthly} barGap={2}>
            <CartesianGrid stroke={T.border} strokeDasharray="3 3" />
            <XAxis dataKey="m" tick={{ fontSize:10, fill:T.text3, fontFamily:mono }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize:10, fill:T.text3, fontFamily:mono }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background:"#141414", border:`1px solid ${T.border}`, borderRadius:8, fontSize:12, fontFamily:mono, color:T.text1 }} />
            <Bar dataKey="total" fill="rgba(255,255,255,0.08)" radius={[4,4,0,0]} />
            <Bar dataKey="confirmed" fill={T.green} opacity={0.6} radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ─── EPO LIST PAGE ─────────────────────────────────────
function EpoPage() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = epos.filter(e => {
    if (filter !== "all" && e.status !== filter) return false;
    if (search && !`${e.vendor} ${e.community} ${e.lot} ${e.desc}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = { all:epos.length, pending:epos.filter(e=>e.status==="pending").length, confirmed:epos.filter(e=>e.status==="confirmed").length, denied:epos.filter(e=>e.status==="denied").length, discount:epos.filter(e=>e.status==="discount").length };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:500, color:T.text1, margin:0, letterSpacing:"-0.04em", fontFamily:font }}>EPOs</h1>
          <span style={{ fontSize:12, color:T.text3, fontFamily:font }}>Manage extra work orders</span>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <Btn><RefreshCw size={14} /> Sync</Btn>
          <Btn primary><Plus size={14} /> Add EPO</Btn>
        </div>
      </div>

      {/* Sync status */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 14px", borderRadius:8, background:T.greenDim, border:`1px solid ${T.greenBdr}`, marginBottom:16 }}>
        <Dot color={T.green} size={6} />
        <span style={{ fontSize:12, color:T.green, fontFamily:font, fontWeight:450 }}>Connected</span>
        <span style={{ fontSize:11, color:"rgba(52,211,153,0.6)", fontFamily:font }}>synced 3m ago via stancil.field.tracker@gmail.com</span>
      </div>

      {/* Filters */}
      <div style={{ display:"flex", gap:4, marginBottom:14 }}>
        {["all","pending","confirmed","denied","discount"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding:"5px 12px", borderRadius:6, fontSize:12, fontWeight:450, fontFamily:font, cursor:"pointer",
            border:`1px solid ${filter === f ? T.borderLt : T.border}`,
            background: filter === f ? T.card : "transparent",
            color: filter === f ? T.text1 : T.text3,
            transition:"all 0.12s",
          }}>
            {f === "all" ? "All" : statusMap[f].label} <Num style={{ fontSize:11, color:T.text3, marginLeft:3 }}>{counts[f]}</Num>
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ position:"relative", marginBottom:16 }}>
        <Search size={13} style={{ position:"absolute", left:11, top:9, color:T.text3 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor, community, lot..."
          style={{ width:"100%", padding:"8px 12px 8px 32px", borderRadius:8, border:`1px solid ${T.border}`, background:"transparent", color:T.text1, fontSize:12, fontFamily:font, outline:"none", boxSizing:"border-box" }} />
      </div>

      {/* Table */}
      <Card style={{ padding:0, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:font }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${T.border}` }}>
              {["Vendor","Community","Lot","Description","Amount","Status","Age"].map(h => (
                <th key={h} style={{ textAlign:"left", padding:"10px 14px", fontSize:10, fontWeight:500, letterSpacing:"0.06em", textTransform:"uppercase", color:T.text3 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((e,i) => (
              <tr key={e.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${T.border}` : "none", cursor:"pointer", transition:"background 0.1s" }}
                onMouseEnter={ev => ev.currentTarget.style.background = T.surface}
                onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                <td style={{ padding:"12px 14px", fontSize:13, fontWeight:450, color:T.text1 }}>{e.vendor}</td>
                <td style={{ padding:"12px 14px", fontSize:12, color:T.text2 }}>{e.community}</td>
                <td style={{ padding:"12px 14px" }}>
                  <Num style={{ fontSize:12, color:T.blue, background:T.blueDim, padding:"2px 7px", borderRadius:4, border:`1px solid ${T.blueBdr}` }}>{e.lot}</Num>
                </td>
                <td style={{ padding:"12px 14px", fontSize:12, color:T.text3, maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.desc}</td>
                <td style={{ padding:"12px 14px" }}><Num style={{ fontSize:13, color:T.text1 }}>${e.amount}</Num></td>
                <td style={{ padding:"12px 14px" }}><Badge status={e.status} /></td>
                <td style={{ padding:"12px 14px" }}>
                  <Num style={{ fontSize:12, color: e.days >= 7 ? T.red : e.days >= 4 ? T.amber : T.text3 }}>{e.days}d</Num>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Follow-up alert */}
      {epos.some(e => e.status === "pending" && e.days >= 4) && (
        <Card glow={T.amberBdr} style={{ marginTop:12, padding:14, display:"flex", alignItems:"center", gap:10 }}>
          <AlertTriangle size={15} color={T.amber} />
          <span style={{ fontSize:12, color:T.amber, fontFamily:font, fontWeight:450 }}>
            {epos.filter(e => e.status === "pending" && e.days >= 4).length} EPOs need follow-up (4+ days open)
          </span>
          <Btn small style={{ marginLeft:"auto", borderColor:T.amberBdr, color:T.amber }}><Send size={12} /> Send All</Btn>
        </Card>
      )}
    </div>
  );
}

// ─── ANALYTICS PAGE ────────────────────────────────────
function AnalyticsPage() {
  const communities = [
    { name:"Mallard Park", count:4, amount:1530, rate:75 },
    { name:"Odell Park", count:3, amount:1215, rate:67 },
    { name:"Galloway", count:2, amount:720, rate:50 },
    { name:"Cedar Hills", count:1, amount:890, rate:0 },
    { name:"Olmsted", count:1, amount:380, rate:0 },
  ];
  const vendors = [
    { name:"Pulte Homes", count:3, amount:810 },
    { name:"Summit Builders", count:2, amount:665 },
    { name:"DRB Homes", count:2, amount:930 },
    { name:"K. Hovnanian", count:1, amount:890 },
  ];

  return (
    <div>
      <h1 style={{ fontSize:22, fontWeight:500, color:T.text1, margin:"0 0 4px", letterSpacing:"-0.04em", fontFamily:font }}>Analytics</h1>
      <span style={{ fontSize:12, color:T.text3, fontFamily:font }}>Performance breakdown</span>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginTop:24 }}>
        {/* By Community */}
        <Card>
          <div style={{ fontSize:13, fontWeight:500, color:T.text1, fontFamily:font, marginBottom:4 }}>By Community</div>
          <Label>EPO value and capture rate</Label>
          <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:12 }}>
            {communities.map((c,i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:12 }}>
                <Num style={{ fontSize:11, color:T.text3, width:18, textAlign:"right" }}>{i+1}</Num>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:13, color:T.text1, fontFamily:font, fontWeight:450 }}>{c.name}</span>
                    <Num style={{ fontSize:12, color:T.text2 }}>${c.amount.toLocaleString()}</Num>
                  </div>
                  <div style={{ height:3, borderRadius:2, background:T.surface }}>
                    <div style={{ height:"100%", borderRadius:2, width:`${c.rate}%`, background: c.rate >= 60 ? T.green : c.rate > 0 ? T.amber : T.text3, opacity:0.6, transition:"width 0.4s" }} />
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
                    <Num style={{ fontSize:10, color:T.text3 }}>{c.count} EPOs</Num>
                    <Num style={{ fontSize:10, color: c.rate >= 60 ? T.green : c.rate > 0 ? T.amber : T.text3 }}>{c.rate}%</Num>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* By Vendor */}
        <Card>
          <div style={{ fontSize:13, fontWeight:500, color:T.text1, fontFamily:font, marginBottom:4 }}>By Vendor</div>
          <Label>Top vendors by volume</Label>
          <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:14 }}>
            {vendors.map((v,i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:8, background:T.surface, border:`1px solid ${T.border}` }}>
                <div style={{ width:32, height:32, borderRadius:7, background:T.card, border:`1px solid ${T.borderLt}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Num style={{ fontSize:12, color:T.text2 }}>{v.name.charAt(0)}</Num>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, color:T.text1, fontFamily:font, fontWeight:450 }}>{v.name}</div>
                  <Num style={{ fontSize:11, color:T.text3 }}>{v.count} EPOs</Num>
                </div>
                <Num style={{ fontSize:14, color:T.text1 }}>${v.amount.toLocaleString()}</Num>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── INTEGRATIONS PAGE ─────────────────────────────────
function ConnectPage() {
  const integrations = [
    { name:"Gmail", desc:"Auto-sync EPO emails from your inbox", icon:Mail, active:true, note:"syncing every 5 min" },
    { name:"Google Sheets", desc:"Export EPO data to a shared spreadsheet", icon:FileSpreadsheet, active:true, note:"last push 10 min ago" },
    { name:"Outlook", desc:"Connect your Microsoft 365 email", icon:Mail, active:false, note:"" },
    { name:"QuickBooks", desc:"Sync confirmed EPOs to accounting", icon:DollarSign, active:false, note:"coming soon" },
  ];
  return (
    <div>
      <h1 style={{ fontSize:22, fontWeight:500, color:T.text1, margin:"0 0 4px", letterSpacing:"-0.04em", fontFamily:font }}>Integrations</h1>
      <span style={{ fontSize:12, color:T.text3, fontFamily:font }}>Connect your tools</span>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginTop:24 }}>
        {integrations.map((it,i) => {
          const Icon = it.icon;
          return (
            <Card key={i} glow={it.active ? T.greenBdr : undefined} style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:9, background: it.active ? T.greenDim : T.surface, border:`1px solid ${it.active ? T.greenBdr : T.border}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Icon size={17} color={it.active ? T.green : T.text3} />
                </div>
                <div>
                  <div style={{ fontSize:14, fontWeight:500, color:T.text1, fontFamily:font }}>{it.name}</div>
                  <div style={{ fontSize:11, color:T.text3, fontFamily:font }}>{it.desc}</div>
                </div>
              </div>
              {it.active ? (
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:11, color:T.green, fontFamily:font }}>
                    <Dot color={T.green} /> {it.note}
                  </span>
                  <Btn small>Configure</Btn>
                </div>
              ) : (
                <Btn style={{ width:"100%", justifyContent:"center", opacity: it.note === "coming soon" ? 0.4 : 1, cursor: it.note === "coming soon" ? "default" : "pointer" }}>
                  {it.note === "coming soon" ? "Coming Soon" : "Connect"}
                </Btn>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── SHELL ─────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dash");
  const pages = { dash:<DashPage />, epos:<EpoPage />, analytics:<AnalyticsPage />, connect:<ConnectPage /> };

  return (
    <div style={{ display:"flex", background:T.bg, minHeight:"100vh", fontFamily:font, color:T.text1 }}>
      <Sidebar page={page} setPage={setPage} />
      <div style={{ flex:1, display:"flex", flexDirection:"column" }}>
        <Topbar />
        <div style={{ flex:1, padding:24, overflowY:"auto" }}>
          {pages[page] || (
            <div style={{ textAlign:"center", paddingTop:80 }}>
              <div style={{ fontSize:18, fontWeight:500, color:T.text1, fontFamily:font }}>{page === "team" ? "Team" : "Settings"}</div>
              <div style={{ fontSize:12, color:T.text3, marginTop:4, fontFamily:font }}>Available in the full build</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

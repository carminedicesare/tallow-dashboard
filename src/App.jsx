import { useState, useEffect, useCallback } from 'react'
import { getShopifyData } from './services/shopifyService.js'
import { getMetaData }    from './services/metaService.js'
import { askClaude }      from './services/claudeService.js'
import { MONTHLY_FIXED, COGS }  from './cogsConfig.js'

// ─── Constants ────────────────────────────────────────────────────────────────
const CACHE_KEY    = 'tallow_dash_v6'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

const TIME_PRESETS = [
  { id: 'this_week',  label: 'This Week' },
  { id: 'last_week',  label: 'Last Week' },
  { id: 'last_7',     label: 'Last 7 Days' },
  { id: 'last_30',    label: 'Last 30 Days' },
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'last_90',    label: 'Last 90 Days' },
  { id: 'ytd',        label: 'YTD' },
]

const TABS = [
  { id: 'overview',  label: 'Overview',   icon: '◈' },
  { id: 'pnl',       label: 'P&L',        icon: '∑' },
  { id: 'orders',    label: 'Orders',     icon: '≡' },
  { id: 'products',  label: 'Products',   icon: '◫' },
  { id: 'ads',       label: 'Ads',        icon: '◎' },
]

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt  = (n, d=0) => n==null||isNaN(n) ? '—' : '$'+n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
const fmtP = (n, d=1) => n==null||isNaN(n) ? '—' : n.toFixed(d)+'%'
const fmtN = (n)      => n==null||isNaN(n) ? '—' : n.toLocaleString('en-US')
const pctChg = (c,p)  => (!p||p===0) ? null : ((c-p)/p)*100
const clamp  = (n,lo,hi) => Math.min(Math.max(n,lo),hi)

// ─── Micro components ─────────────────────────────────────────────────────────

function Badge({ val, suffix='%', decimals=1, neutral=false }) {
  if (val == null) return <span className="badge neutral">—</span>
  const pos = val >= 0
  return (
    <span className={`badge ${neutral ? 'neutral' : pos ? 'pos' : 'neg'}`}>
      {pos ? '▲' : '▼'} {Math.abs(val).toFixed(decimals)}{suffix}
    </span>
  )
}

function Delta({ curr, prev, prefix='', suffix='' }) {
  const chg = pctChg(curr, prev)
  if (chg == null) return <span style={{fontSize:11,color:'var(--text-dim)'}}>vs prior period</span>
  const pos = chg >= 0
  return (
    <span style={{fontSize:11,color:pos?'var(--green)':'var(--red)',display:'flex',alignItems:'center',gap:3}}>
      {pos?'▲':'▼'} {Math.abs(chg).toFixed(1)}% vs prior
    </span>
  )
}

function Pill({ value, decimals=2 }) {
  if (value == null || isNaN(value)) return <span style={{color:'var(--text-dim)'}}>—</span>
  const pos = value >= 0
  return (
    <span className={`profit-pill ${pos?'pos':'neg'}`}>
      {pos?'+':''}{fmt(value, decimals)}
    </span>
  )
}

function MBar({ pct, showLabel=true }) {
  if (pct == null) return <span style={{color:'var(--text-dim)',fontSize:12}}>—</span>
  const cls = pct >= 60 ? 'high' : pct >= 35 ? 'med' : 'low'
  return (
    <div className="mbar-wrap">
      <div className="mbar-track">
        <div className={`mbar-fill ${cls}`} style={{width:`${clamp(pct,0,100)}%`}} />
      </div>
      {showLabel && <span className="mbar-label">{fmtP(pct)}</span>}
    </div>
  )
}

// ─── SVG Sparkline ────────────────────────────────────────────────────────────
function Spark({ data, color='#7F77DD', h=40, showDots=false }) {
  if (!data || data.length < 2) return null
  const W=260, pad=4
  const max=Math.max(...data,1), min=Math.min(...data,0), rng=max-min||1
  const pts = data.map((v,i)=>{
    const x=pad+(i/(data.length-1))*(W-pad*2)
    const y=h-pad-((v-min)/rng)*(h-pad*2)
    return [x,y]
  })
  const path  = 'M '+pts.map(p=>p.join(',')).join(' L ')
  const area  = path+` L ${pts[pts.length-1][0]},${h} L ${pad},${h} Z`
  const gid   = `sg${color.replace(/[^a-z0-9]/gi,'')}`
  const [lx,ly] = pts[pts.length-1]
  return (
    <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" style={{width:'100%',height:h}}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`}/>
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      {showDots && pts.map(([x,y],i)=><circle key={i} cx={x} cy={y} r="2.5" fill={color} opacity="0.7"/>)}
      <circle cx={lx} cy={ly} r="3.5" fill={color}/>
    </svg>
  )
}

// ─── Bar chart (horizontal) ───────────────────────────────────────────────────
function HBar({ items, valueKey='revenue', labelKey='name', colorFn }) {
  if (!items?.length) return null
  const max = Math.max(...items.map(i=>i[valueKey]),1)
  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {items.map((item,i)=>{
        const pct = (item[valueKey]/max)*100
        const color = colorFn ? colorFn(item,i) : 'var(--purple)'
        return (
          <div key={item[labelKey]||i}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:5}}>
              <span style={{fontSize:13,color:'var(--text)',fontWeight:500}}>{item[labelKey]}</span>
              <div style={{display:'flex',gap:10,alignItems:'baseline'}}>
                {item.revenue != null && <span style={{fontSize:13,fontWeight:700}}>{fmt(item.revenue,2)}</span>}
                {item.qty != null && <span style={{fontSize:11,color:'var(--text-dim)'}}>{item.qty} units</span>}
                {item.marginPct != null && <span style={{fontSize:11,color:item.marginPct>=50?'var(--green)':'var(--yellow)'}}>{fmtP(item.marginPct)} margin</span>}
              </div>
            </div>
            <div style={{height:6,background:'var(--surface2)',borderRadius:3,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${pct}%`,background:color,borderRadius:3,transition:'width 0.5s ease',minWidth:4}}/>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Daily bar chart ──────────────────────────────────────────────────────────
function DailyBars({ data, valueKey='revenue', color='var(--purple)', height=100 }) {
  if (!data?.length) return null

  // Group data to keep bar count manageable (max ~20 bars)
  const raw = data
  const grouped = (() => {
    if (raw.length <= 14) return raw // daily — show as-is
    if (raw.length <= 60) {
      // Group into weeks
      const weeks = {}
      raw.forEach(d => {
        const dt = new Date(d.date + 'T12:00:00')
        // Get Monday of that week
        const day = dt.getDay()
        const diff = (day === 0 ? -6 : 1 - day)
        const mon = new Date(dt); mon.setDate(dt.getDate() + diff)
        const key = mon.toISOString().split('T')[0]
        if (!weeks[key]) weeks[key] = { date: key, [valueKey]: 0 }
        weeks[key][valueKey] += d[valueKey]
      })
      return Object.values(weeks).sort((a,b) => a.date.localeCompare(b.date))
    }
    // Group into months
    const months = {}
    raw.forEach(d => {
      const key = d.date.substring(0, 7) // YYYY-MM
      if (!months[key]) months[key] = { date: key + '-01', [valueKey]: 0 }
      months[key][valueKey] += d[valueKey]
    })
    return Object.values(months).sort((a,b) => a.date.localeCompare(b.date))
  })()

  const count  = grouped.length
  const max    = Math.max(...grouped.map(d => d[valueKey]), 1)
  const labelH = 18
  const valueH = count <= 14 ? 16 : 0
  const chartH = height - labelH - valueH
  const isWeekly  = raw.length > 14 && raw.length <= 60
  const isMonthly = raw.length > 60

  return (
    <div style={{width:'100%'}}>
      {(isWeekly || isMonthly) && (
        <div style={{fontSize:9,color:'var(--text-muted)',marginBottom:4,textAlign:'right'}}>
          {isWeekly ? 'Weekly totals' : 'Monthly totals'}
        </div>
      )}
      <div style={{display:'flex', alignItems:'flex-end', gap:4, paddingTop:valueH, width:'100%'}}>
        {grouped.map((d, i) => {
          const pct  = d[valueKey] / max
          const barH = Math.max(3, Math.round(pct * chartH))
          const isLast = i === grouped.length - 1
          const dt   = new Date(d.date + 'T12:00:00')
          const label = isMonthly
            ? dt.toLocaleDateString('en-US', {month:'short'})
            : dt.toLocaleDateString('en-US', {month:'short', day:'numeric'})
          return (
            <div key={i} style={{
              flex: 1,
              display:'flex', flexDirection:'column', alignItems:'center',
              gap:3, position:'relative', minWidth:0,
            }}>
              {count <= 14 && (
                <span style={{fontSize:9,color:'var(--text-dim)',position:'absolute',top:-valueH,whiteSpace:'nowrap'}}>
                  {fmt(d[valueKey],0)}
                </span>
              )}
              <div style={{
                width:'100%', height:barH,
                background: isLast ? 'var(--purple-light)' : color,
                borderRadius:'2px 2px 0 0',
                transition:'height 0.4s ease',
                opacity: isLast ? 1 : 0.75,
              }}/>
              <span style={{fontSize:8,color:'var(--text-dim)',whiteSpace:'nowrap',height:labelH,overflow:'hidden',maxWidth:'100%',textAlign:'center'}}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Waterfall chart ──────────────────────────────────────────────────────────
function Waterfall({ items }) {
  // items: [{label, value, type:'add'|'sub'|'total'}]
  if (!items?.length) return null
  const maxAbs = Math.max(...items.map(i=>Math.abs(i.value)),1)
  return (
    <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:8}}>
      {items.map((item,i)=>{
        const isTotal = item.type==='total'
        const isAdd   = item.type==='add'
        const color   = isTotal ? 'var(--purple)' : isAdd ? 'var(--green)' : 'var(--red)'
        const pct     = clamp((Math.abs(item.value)/maxAbs)*100,1,100)
        return (
          <div key={i} style={{display:'grid',gridTemplateColumns:'minmax(100px,160px) 1fr minmax(60px,80px)',alignItems:'center',gap:8}}>
            <span style={{fontSize:12,color:isTotal?'var(--text)':'var(--text-dim)',fontWeight:isTotal?700:400,textAlign:'right'}}>{item.label}</span>
            <div style={{height:isTotal?10:7,background:'var(--surface2)',borderRadius:4,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${pct}%`,background:color,borderRadius:4,transition:'width 0.5s ease'}}/>
            </div>
            <span style={{fontSize:12,fontWeight:isTotal?700:500,color,textAlign:'right'}}>
              {isAdd?'+':item.type==='sub'?'−':''}{fmt(Math.abs(item.value),2)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Donut chart (pure SVG) ───────────────────────────────────────────────────
function Donut({ slices, size=120, thickness=20 }) {
  // slices: [{label, value, color}]
  if (!slices?.length) return null
  const total = slices.reduce((s,sl)=>s+sl.value,0)
  if (!total) return null
  const R = (size/2) - thickness/2
  const C = size/2
  let angle = -90
  const paths = slices.map(sl=>{
    const pct = sl.value/total
    const startAngle = angle
    angle += pct*360
    const endAngle = angle
    const start = { x: C+R*Math.cos((startAngle*Math.PI)/180), y: C+R*Math.sin((startAngle*Math.PI)/180) }
    const end   = { x: C+R*Math.cos((endAngle*Math.PI)/180),   y: C+R*Math.sin((endAngle*Math.PI)/180) }
    const large = pct > 0.5 ? 1 : 0
    return { ...sl, d: `M ${start.x} ${start.y} A ${R} ${R} 0 ${large} 1 ${end.x} ${end.y}`, pct }
  })
  return (
    <svg width={size} height={size} style={{flexShrink:0}}>
      {paths.map((p,i)=>(
        <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={thickness} strokeLinecap="butt"/>
      ))}
    </svg>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KCard({ label, value, prev, currRaw, prevRaw, sub, accent, icon, large }) {
  const chg = pctChg(currRaw, prevRaw)
  return (
    <div className="kcard" style={accent?{borderTopColor:accent}:{}}>
      <div className="kcard-header">
        <span className="kcard-label">{label}</span>
        {icon && <span style={{fontSize:16,opacity:0.4}}>{icon}</span>}
      </div>
      <div className={`kcard-value ${large?'large':''}`}>{value}</div>
      <div className="kcard-footer">
        <Delta curr={currRaw} prev={prevRaw}/>
        {sub && <span className="kcard-sub">{sub}</span>}
      </div>
    </div>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHead({ title, sub }) {
  return (
    <div style={{marginBottom:4}}>
      <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:1,color:'var(--text-dim)'}}>{title}</div>
      {sub && <div style={{fontSize:11,color:'var(--text-dim)',marginTop:1}}>{sub}</div>}
    </div>
  )
}

// ─── Line row (income statement) ──────────────────────────────────────────────
function LR({ label, value, color, bold, border, indent, section }) {
  if (section) return (
    <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:1,color:'var(--text-dim)',padding:'14px 0 4px',marginLeft:0}}>
      {label}
    </div>
  )
  return (
    <div style={{
      display:'flex',justifyContent:'space-between',alignItems:'center',
      padding:`${border?'9px':'5px'} 0`,
      borderTop: border?'1px solid var(--border)':'none',
      marginLeft: indent?20:0,
    }}>
      <span style={{fontSize:13,color:bold?'var(--text)':'var(--text-dim)',fontWeight:bold?600:400}}>{label}</span>
      <span style={{fontSize:13,color:color||'var(--text)',fontWeight:bold?700:500}}>{value}</span>
    </div>
  )
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────────────────────
function OverviewTab({ curr, prev, metaData, weeklyFixed, totalMonthlyFixed, shopifyData }) {
  if (!curr) return null
  const ad  = metaData?.spend||0
  const nop = curr.netProfit - ad - weeklyFixed   // net operating profit

  // Cost composition for donut
  const donutSlices = [
    { label:'COGS',       value: curr.totalCOGS,          color:'#f05e5e' },
    { label:'Fees',       value: curr.totalFees||0,        color:'#f5a623' },
    { label:'Postage',    value: curr.postageCost||0,       color:'#e8774d' },
    { label:'Ad Spend',   value: ad,                       color:'#9b59b6' },
    { label:'Overhead',   value: weeklyFixed,              color:'#5b7fa6' },
    { label:'Net Profit', value: Math.max(nop,0),          color:'#4cd480' },
  ].filter(s=>s.value>0)

  const profitWaterfall = [
    { label:'Net Revenue',   value: curr.netRevenue,                    type:'add'   },
    { label:'COGS',          value: curr.totalCOGS,                     type:'sub'   },
    { label:'Order Fees',    value: (curr.totalFees||0)+(curr.postageCost||0), type:'sub' },
    { label:'Ad Spend',      value: ad,                                 type:'sub'   },
    { label:'Fixed Overhead',value: weeklyFixed,                        type:'sub'   },
    { label:'Net Operating', value: Math.abs(nop),                      type:'total' },
  ]

  return (
    <div style={{display:'flex',flexDirection:'column',gap:20}}>

      {/* ── Row 1: Primary KPIs ─────────────────────────────────────── */}
      <div className="kpi-grid-4">
        <KCard label="Net Revenue"    value={fmt(curr.netRevenue,2)}   currRaw={curr.netRevenue}  prevRaw={prev?.netRevenue}  sub={`${fmtN(curr.orderCount)} orders · AOV ${fmt(curr.aov,2)}`}     accent="var(--green)"  icon="$"/>
        <KCard label="Gross Profit"   value={fmt(curr.grossProfit,2)}  currRaw={curr.grossProfit} prevRaw={prev?.grossProfit} sub={`${fmtP(curr.grossMarginPct)} gross margin`}                      accent={curr.grossProfit>=0?'var(--green)':'var(--red)'} icon="◈"/>
        <KCard label="Net Op. Profit" value={fmt(nop,2)}               currRaw={nop}              prevRaw={prev?prev.netProfit-ad-weeklyFixed:null} sub="After all costs + overhead"              accent={nop>=0?'var(--green)':'var(--red)'} icon="∑"/>
        <KCard label="Orders"         value={fmtN(curr.orderCount)}    currRaw={curr.orderCount}  prevRaw={prev?.orderCount}  sub={`${curr.refunds>0?fmt(curr.refunds,2)+' refunded':'No refunds'}`} accent="var(--purple)" icon="≡"/>
      </div>

      {/* ── Row 2: Secondary KPIs ───────────────────────────────────── */}
      <div className="kpi-grid-4">
        <KCard label="ROAS"           value={metaData?.roas!=null?`${metaData.roas.toFixed(2)}×`:'—'} sub={ad>0?`Spend ${fmt(ad,2)}`:'Connect Meta Ads'} accent="var(--purple)" icon="◎"/>
        <KCard label="Avg Order Value" value={fmt(curr.aov,2)} currRaw={curr.aov} prevRaw={prev?.aov} sub="Net revenue ÷ orders" icon="⊘"/>
        <KCard label="Total COGS"     value={fmt(curr.totalCOGS,2)} sub={`${fmtP(curr.netRevenue>0?(curr.totalCOGS/curr.netRevenue)*100:0)} of revenue`} icon="⊡"/>
        <KCard label="Shipping Margin" value={fmt(curr.shippingMargin,2)} currRaw={curr.shippingMargin} sub={`Collected ${fmt(curr.shippingCollected,2)} · Paid ${fmt(curr.postageCost,2)}`} accent={(curr.shippingMargin||0)>=0?'var(--green)':'var(--red)'} icon="⊞"/>
      </div>

      {/* ── Row 3: Charts ───────────────────────────────────────────── */}
      <div className="grid-2-1">
        {/* Revenue by product */}
        <div className="card">
          <SectionHead title="Revenue by Product" sub="Sorted by revenue contribution"/>
          <div style={{marginTop:16}}>
            <HBar
              items={[...curr.skuBreakdown].sort((a,b)=>b.revenue-a.revenue).slice(0,8)}
              colorFn={(_,i)=>`hsl(${250+i*18},60%,${65-i*3}%)`}
            />
          </div>
        </div>

        {/* Cash waterfall */}
        <div className="card">
          <SectionHead title="Profit Waterfall" sub="Where every dollar goes"/>
          <div style={{marginTop:4}}>
            <div style={{textAlign:'center',marginBottom:8}}>
              <div style={{fontSize:28,fontWeight:800,color:nop>=0?'var(--green)':'var(--red)'}}>{fmt(nop,2)}</div>
              <div style={{fontSize:11,color:'var(--text-dim)'}}>Net Operating Profit</div>
            </div>
            <Waterfall items={profitWaterfall}/>
          </div>
        </div>
      </div>

      {/* ── Row 4: Daily trend + cost mix ───────────────────────────── */}
      <div className="grid-3-2">
        {/* Daily revenue */}
        <div className="card">
          <SectionHead title="Daily Revenue" sub="Net revenue by day"/>
          {curr.dailyRevenue?.length > 1
            ? <DailyBars data={curr.dailyRevenue} valueKey="revenue" height={110}/>
            : <div style={{color:'var(--text-dim)',fontSize:12,padding:'20px 0'}}>Insufficient data</div>
          }
        </div>

        {/* Cost composition */}
        <div className="card">
          <SectionHead title="Cost Composition" sub="How costs break down"/>
          <div style={{display:'flex',alignItems:'center',gap:20,marginTop:12}}>
            <Donut slices={donutSlices} size={110} thickness={18}/>
            <div style={{flex:1,display:'flex',flexDirection:'column',gap:6}}>
              {donutSlices.map(s=>(
                <div key={s.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <div style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0}}/>
                    <span style={{color:'var(--text-dim)'}}>{s.label}</span>
                  </div>
                  <span style={{fontWeight:600}}>{fmt(s.value,2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 5: Quick stats ──────────────────────────────────────── */}
      <div className="grid-3">
        {/* Top SKU */}
        <div className="card">
          <SectionHead title="Top SKU by Revenue"/>
          {(() => {
            const top = [...curr.skuBreakdown].sort((a,b)=>b.revenue-a.revenue)[0]
            if (!top) return null
            return (
              <div style={{marginTop:10}}>
                <div style={{fontSize:18,fontWeight:700,color:'var(--purple-light)',marginBottom:4}}>{top.name}</div>
                <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                  {[
                    {l:'Revenue',v:fmt(top.revenue,2)},
                    {l:'Units',v:fmtN(top.qty)},
                    {l:'Gross Margin',v:fmtP(top.marginPct)},
                  ].map(({l,v})=>(
                    <div key={l}>
                      <div style={{fontSize:10,color:'var(--text-dim)',textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                      <div style={{fontSize:15,fontWeight:700}}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Best margin SKU */}
        <div className="card">
          <SectionHead title="Highest Margin SKU"/>
          {(() => {
            const top = [...curr.skuBreakdown].filter(s=>s.unitCost>0&&s.qty>0).sort((a,b)=>b.marginPct-a.marginPct)[0]
            if (!top) return null
            return (
              <div style={{marginTop:10}}>
                <div style={{fontSize:18,fontWeight:700,color:'var(--green)',marginBottom:4}}>{top.name}</div>
                <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                  {[
                    {l:'Margin',v:fmtP(top.marginPct)},
                    {l:'Unit COGS',v:fmt(top.unitCost,2)},
                    {l:'Unit Price',v:fmt(top.unitPrice,2)},
                  ].map(({l,v})=>(
                    <div key={l}>
                      <div style={{fontSize:10,color:'var(--text-dim)',textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                      <div style={{fontSize:15,fontWeight:700}}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Refund rate */}
        <div className="card">
          <SectionHead title="Refund &amp; Discount Impact"/>
          <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:8}}>
            {[
              {l:'Refunds', v:curr.refunds, total:curr.grossRevenue},
              {l:'Discounts', v:curr.discounts, total:curr.grossRevenue},
            ].map(({l,v,total})=>(
              <div key={l}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                  <span style={{color:'var(--text-dim)'}}>{l}</span>
                  <span style={{color:v>0?'var(--red)':'var(--text-dim)',fontWeight:600}}>
                    {v>0?`−${fmt(v,2)}`:'$0.00'}
                    {v>0&&total>0&&<span style={{color:'var(--text-dim)',fontWeight:400}}> ({fmtP((v/total)*100,1)})</span>}
                  </span>
                </div>
                <div style={{height:4,background:'var(--surface2)',borderRadius:2,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${total>0?clamp((v/total)*100,0,100):0}%`,background:'var(--red)',borderRadius:2}}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Claude Q&A ──────────────────────────────────────────────── */}
      <ClaudeQA financialData={{shopify:shopifyData,meta:metaData}}/>
    </div>
  )
}

// ─── P&L TAB ──────────────────────────────────────────────────────────────────
function PnLTab({ curr, metaData, weeklyFixed, totalMonthlyFixed, rangeLabel }) {
  if (!curr) return null
  const ad  = metaData?.spend||0
  const nop = curr.netProfit - ad - weeklyFixed
  const nopPct = curr.netRevenue>0 ? (nop/curr.netRevenue)*100 : 0

  return (
    <div style={{display:'flex',flexDirection:'column',gap:20}}>

      {/* Top 5-number summary */}
      <div className="kpi-grid-5">
        {[
          { l:'Gross Revenue',      v:fmt(curr.grossRevenue,2),  c:'var(--green)' },
          { l:'Net Revenue',        v:fmt(curr.netRevenue,2),    c:'var(--green)' },
          { l:'Gross Profit',       v:fmt(curr.grossProfit,2),   c:curr.grossProfit>=0?'var(--green)':'var(--red)' },
          { l:'Net Op. Profit',     v:fmt(nop,2),                c:nop>=0?'var(--green)':'var(--red)' },
          { l:'Net Op. Margin',     v:fmtP(nopPct),              c:nopPct>=20?'var(--green)':nopPct>=0?'var(--yellow)':'var(--red)' },
        ].map(({l,v,c})=>(
          <div key={l} className="card" style={{textAlign:'center',padding:16}}>
            <div className="kcard-label">{l}</div>
            <div style={{fontSize:22,fontWeight:800,color:c,marginTop:6,lineHeight:1}}>{v}</div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        {/* Full income statement */}
        <div className="card">
          <SectionHead title={`Income Statement — ${rangeLabel}`}/>
          <div style={{marginTop:12}}>
            <LR section label="Revenue"/>
            <LR label="Product Revenue"      value={fmt((curr.grossRevenue||0)-(curr.shippingCollected||0),2)} color="var(--green)"/>
            <LR label="Shipping Collected"   value={curr.shippingCollected>0?`+${fmt(curr.shippingCollected,2)}`:'$0.00'} color={curr.shippingCollected>0?'var(--green)':'var(--text-dim)'} indent/>
            <LR label="Gross Revenue"        value={fmt(curr.grossRevenue,2)} bold/>
            <LR label="Refunds"              value={curr.refunds>0?`−${fmt(curr.refunds,2)}`:'$0.00'} color={curr.refunds>0?'var(--red)':'var(--text-dim)'} indent/>
            <LR label="Discounts"            value={curr.discounts>0?`−${fmt(curr.discounts,2)}`:'$0.00'} color={curr.discounts>0?'var(--red)':'var(--text-dim)'} indent/>
            <LR label="Net Revenue"          value={fmt(curr.netRevenue,2)} bold border color="var(--green)"/>

            <LR section label="Cost of Goods Sold"/>
            <LR label="Total COGS"           value={`−${fmt(curr.totalCOGS,2)}`} color="var(--red)"/>
            <LR label="Gross Profit"         value={fmt(curr.grossProfit,2)} bold border color={curr.grossProfit>=0?'var(--green)':'var(--red)'}/>
            <LR label="Gross Margin"         value={fmtP(curr.grossMarginPct)} indent/>

            <LR section label="Variable Operating Expenses"/>
            <LR label="3PL Pick Fees"        value={`−${fmt(curr.feeBreakdown?.threepl,2)}`}    color="var(--red)" indent/>
            <LR label="Packaging"            value={`−${fmt(curr.feeBreakdown?.packaging,2)}`}  color="var(--red)" indent/>
            <LR label="Shopify Processing"   value={`−${fmt(curr.feeBreakdown?.processing,2)}`} color="var(--red)" indent/>
            <LR label="Postage"              value={curr.postageCost>0?`−${fmt(curr.postageCost,2)}`:'—'} color={curr.postageCost>0?'var(--red)':'var(--text-dim)'} indent/>
            <LR label="Total Variable Fees"  value={`−${fmt((curr.totalFees||0)+(curr.postageCost||0),2)}`} color="var(--red)" bold/>

            <LR section label="Fixed &amp; Marketing Expenses"/>
            <LR label="Ad Spend (Meta)"      value={ad>0?`−${fmt(ad,2)}`:'—'} color={ad>0?'var(--red)':'var(--text-dim)'} indent/>
            <LR label="Fixed Overhead"       value={`−${fmt(weeklyFixed,2)}`} color="var(--red)" indent/>
            <LR label={`  (${fmt(totalMonthlyFixed)}/mo ÷ 4.33 wks)`} value="" indent/>

            <LR label="Net Operating Profit" value={fmt(nop,2)} bold border color={nop>=0?'var(--green)':'var(--red)'}/>
            <LR label="Net Operating Margin" value={fmtP(nopPct)} indent/>
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {/* Margin bridge */}
          <div className="card">
            <SectionHead title="Margin Bridge" sub="Gross → Net erosion"/>
            <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:8}}>
              {[
                { label:'Gross Margin',   pct: curr.grossMarginPct,      color:'var(--green)' },
                { label:'After Fees',     pct: curr.netRevenue>0?((curr.grossProfit-(curr.totalFees||0)-(curr.postageCost||0))/curr.netRevenue)*100:0, color:'var(--yellow)' },
                { label:'After Ad Spend', pct: curr.netRevenue>0?((curr.grossProfit-(curr.totalFees||0)-(curr.postageCost||0)-ad)/curr.netRevenue)*100:0, color:'var(--orange)' },
                { label:'Net Op. Margin', pct: nopPct,                   color: nopPct>=0?'var(--green)':'var(--red)' },
              ].map(({label,pct,color})=>(
                <div key={label}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                    <span style={{color:'var(--text-dim)'}}>{label}</span>
                    <span style={{color,fontWeight:700}}>{fmtP(pct)}</span>
                  </div>
                  <div style={{height:8,background:'var(--surface2)',borderRadius:4,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${clamp(pct,0,100)}%`,background:color,borderRadius:4,transition:'width 0.5s'}}/>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fee detail */}
          <div className="card">
            <SectionHead title="Variable Fee Breakdown"/>
            <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:0}}>
              {[
                { l:'3PL Pick Fees',      v:curr.feeBreakdown?.threepl,    note:'$2.50 first + $0.50 add\'l' },
                { l:'Packaging',          v:curr.feeBreakdown?.packaging,  note:`$0.30 × ${curr.orderCount} orders` },
                { l:'Shopify Processing', v:curr.feeBreakdown?.processing, note:'2.9% + $0.30/txn' },
                { l:'Postage (3PL)',       v:curr.postageCost||0,           note:'Carrier rate via Shopify proxy' },
              ].map(({l,v,note})=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:'1px solid var(--border)'}}>
                  <div>
                    <div style={{fontSize:13}}>{l}</div>
                    <div style={{fontSize:11,color:'var(--text-dim)'}}>{note}</div>
                  </div>
                  <div style={{fontSize:14,fontWeight:600,color:'var(--red)'}}>{v!=null&&v>0?`−${fmt(v,2)}`:'—'}</div>
                </div>
              ))}
              {/* Shipping P&L */}
              <div style={{marginTop:10,padding:'10px',background:'var(--surface2)',borderRadius:6}}>
                <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:6,textTransform:'uppercase',letterSpacing:0.6}}>Shipping P&amp;L</div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}>
                  <span style={{color:'var(--text-dim)'}}>Collected from customers</span>
                  <span style={{color:'var(--green)',fontWeight:600}}>+{fmt(curr.shippingCollected,2)}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:6}}>
                  <span style={{color:'var(--text-dim)'}}>Actual postage paid</span>
                  <span style={{color:'var(--red)',fontWeight:600}}>−{fmt(curr.postageCost,2)}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:13,fontWeight:700,borderTop:'1px solid var(--border)',paddingTop:6}}>
                  <span>Shipping Margin</span>
                  <span style={{color:(curr.shippingMargin||0)>=0?'var(--green)':'var(--red)'}}>
                    {(curr.shippingMargin||0)>=0?'+':''}{fmt(curr.shippingMargin,2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Fixed overhead */}
          <div className="card">
            <SectionHead title="Fixed Overhead" sub={`$${totalMonthlyFixed}/mo · ${fmt(weeklyFixed,2)}/wk`}/>
            <div style={{marginTop:10}}>
              {[
                {l:'Shopify Subscription',   v:29,   note:'Basic, billed annually'},
                {l:'3PL Account Mgmt',        v:100,  note:'$25/wk'},
                {l:'3PL Storage',             v:79,   note:'$19.25/wk'},
                {l:'Marketing Agency',        v:1250, note:'Monthly retainer'},
              ].map(({l,v,note})=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:'1px solid var(--border)'}}>
                  <div>
                    <div style={{fontSize:13}}>{l}</div>
                    <div style={{fontSize:11,color:'var(--text-dim)'}}>{note}</div>
                  </div>
                  <span style={{fontSize:13,color:'var(--red)',fontWeight:500}}>−${v}/mo</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Daily chart */}
      {curr.dailyRevenue?.length>1 && (
        <div className="card">
          <SectionHead title="Daily Revenue Trend"/>
          <DailyBars data={curr.dailyRevenue} height={120}/>
        </div>
      )}
    </div>
  )
}

// ─── ORDERS TAB ───────────────────────────────────────────────────────────────
function OrdersTab({ enrichedOrders }) {
  const [sort, setSort]   = useState({col:'createdAt',dir:'desc'})
  const [search, setSrch] = useState('')
  const [expand, setExp]  = useState(null)
  const [filter, setFilt] = useState('all') // all | profitable | refunded

  if (!enrichedOrders?.length) return (
    <div className="card" style={{textAlign:'center',padding:60,color:'var(--text-dim)'}}>No orders in this period</div>
  )

  const toggleSort = col => setSort(s => ({col, dir: s.col===col&&s.dir==='desc'?'asc':'desc'}))

  const filtered = enrichedOrders.filter(o => {
    if (filter==='profitable' && o.netProfit<0) return false
    if (filter==='refunded'   && !o.isRefunded) return false
    const q = search.toLowerCase()
    if (!q) return true
    return String(o.orderNumber).includes(q) || o.email.toLowerCase().includes(q) ||
           o.lineItems.some(li=>li.name.toLowerCase().includes(q))
  })

  const sorted = [...filtered].sort((a,b)=>{
    let av=a[sort.col], bv=b[sort.col]
    if (sort.col==='createdAt'){av=new Date(av);bv=new Date(bv)}
    if(av<bv) return sort.dir==='asc'?-1:1
    if(av>bv) return sort.dir==='asc'?1:-1
    return 0
  })

  const SI = ({col}) => sort.col===col
    ? <span style={{color:'var(--purple)',marginLeft:3}}>{sort.dir==='asc'?'↑':'↓'}</span>
    : <span style={{opacity:.2,marginLeft:3}}>↕</span>

  // Period stats
  const totalProfit = sorted.reduce((s,o)=>s+o.netProfit,0)
  const profitable  = sorted.filter(o=>o.netProfit>=0).length
  const avgMargin   = sorted.length ? sorted.reduce((s,o)=>s+o.netMarginPct,0)/sorted.length : 0
  const totalPost   = sorted.reduce((s,o)=>s+(o.postageCost||0),0)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>

      {/* Summary strip */}
      <div className="kpi-grid-4">
        {[
          {l:'Orders Shown', v:fmtN(sorted.length), sub:`of ${enrichedOrders.length} total`},
          {l:'Total Net Profit', v:fmt(totalProfit,2), sub:`${profitable} profitable orders`, accent:totalProfit>=0?'var(--green)':'var(--red)'},
          {l:'Avg Net Margin', v:fmtP(avgMargin), sub:'Across shown orders', accent:avgMargin>=40?'var(--green)':avgMargin>=20?'var(--yellow)':'var(--red)'},
          {l:'Total Postage', v:fmt(totalPost,2), sub:'3PL carrier charges'},
        ].map(({l,v,sub,accent})=>(
          <div key={l} className="kcard" style={accent?{borderTopColor:accent}:{}}>
            <div className="kcard-label">{l}</div>
            <div className="kcard-value" style={{fontSize:22}}>{v}</div>
            <div className="kcard-sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <div style={{padding:'14px 20px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div className="card-title" style={{margin:0,flex:1}}>Order P&amp;L — {sorted.length} orders</div>
          <div style={{display:'flex',gap:6}}>
            {['all','profitable','refunded'].map(f=>(
              <button key={f} onClick={()=>setFilt(f)}
                style={{
                  padding:'4px 12px',borderRadius:20,fontSize:11,cursor:'pointer',border:'1px solid',
                  background:filter===f?'var(--purple-dim)':'transparent',
                  borderColor:filter===f?'var(--purple)':'var(--border)',
                  color:filter===f?'var(--purple-light)':'var(--text-dim)',
                  fontWeight:filter===f?600:400,
                }}>
                {f.charAt(0).toUpperCase()+f.slice(1)}
              </button>
            ))}
          </div>
          <input
            type="text" placeholder="Search order #, email, product…"
            value={search} onChange={e=>setSrch(e.target.value)}
            style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:6,padding:'6px 12px',color:'var(--text)',fontSize:12,width:220,outline:'none'}}
          />
        </div>

        <div style={{overflowX:'auto'}}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{cursor:'pointer'}} onClick={()=>toggleSort('orderNumber')}>Order <SI col="orderNumber"/></th>
                <th style={{cursor:'pointer'}} onClick={()=>toggleSort('createdAt')}>Date <SI col="createdAt"/></th>
                <th>Customer</th>
                <th style={{textAlign:'right',cursor:'pointer'}} onClick={()=>toggleSort('grossRevenue')}>Revenue <SI col="grossRevenue"/></th>
                <th style={{textAlign:'right'}}>COGS</th>
                <th style={{textAlign:'right'}}>Fees+Post.</th>
                <th style={{textAlign:'right',cursor:'pointer'}} onClick={()=>toggleSort('netProfit')}>Net Profit <SI col="netProfit"/></th>
                <th style={{textAlign:'right',cursor:'pointer'}} onClick={()=>toggleSort('netMarginPct')}>Margin <SI col="netMarginPct"/></th>
                <th style={{textAlign:'right'}}>Ship Δ</th>
                <th style={{textAlign:'right'}}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(o=>(
                <>
                  <tr key={o.id} onClick={()=>setExp(expand===o.id?null:o.id)}
                    style={{cursor:'pointer'}} className={expand===o.id?'row-expanded':''}>
                    <td><span style={{color:'var(--purple)',fontWeight:700}}>#{o.orderNumber}</span></td>
                    <td style={{color:'var(--text-dim)',whiteSpace:'nowrap',fontSize:12}}>
                      {new Date(o.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                    </td>
                    <td style={{color:'var(--text-dim)',fontSize:12,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.email||'—'}</td>
                    <td style={{textAlign:'right'}}>{fmt(o.grossRevenue,2)}</td>
                    <td style={{textAlign:'right',color:'var(--red)',fontSize:12}}>−{fmt(o.totalCOGS,2)}</td>
                    <td style={{textAlign:'right',color:'var(--red)',fontSize:12}}>−{fmt((o.fees?.total||0)+(o.postageCost||0),2)}</td>
                    <td style={{textAlign:'right'}}><Pill value={o.netProfit}/></td>
                    <td style={{textAlign:'right'}}><MBar pct={o.netMarginPct}/></td>
                    <td style={{textAlign:'right',fontSize:12}}>
                      <span style={{color:(o.shippingMargin||0)>=0?'var(--green)':'var(--red)',fontWeight:600}}>
                        {(o.shippingMargin||0)>=0?'+':''}{fmt(o.shippingMargin,2)}
                      </span>
                    </td>
                    <td style={{textAlign:'right'}}>
                      <span className={`status-badge ${o.isRefunded?'refunded':'paid'}`}>
                        {o.isRefunded?'Refunded':'Paid'}
                      </span>
                    </td>
                  </tr>
                  {expand===o.id && (
                    <tr key={`${o.id}-d`} className="row-detail">
                      <td colSpan={10}>
                        <div style={{padding:'14px 16px',background:'var(--surface2)',borderRadius:6,margin:'4px 0',display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
                          <div>
                            <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:8,textTransform:'uppercase',letterSpacing:0.6}}>Line Items</div>
                            {o.lineItems.map((li,i)=>(
                              <div key={i} style={{display:'grid',gridTemplateColumns:'1fr auto',fontSize:12,padding:'6px 0',borderBottom:'1px solid var(--border)',gap:8}}>
                                <span style={{fontWeight:500}}>{li.name} × {li.qty}</span>
                                <div style={{display:'flex',gap:12,justifyContent:'flex-end'}}>
                                  <span style={{color:'var(--text-dim)'}}>{fmt(li.revenue,2)} rev</span>
                                  <span style={{color:'var(--red)'}}>−{fmt(li.cogs,2)} COGS</span>
                                  <span style={{color:li.grossProfit>=0?'var(--green)':'var(--red)',fontWeight:700}}>{fmt(li.grossProfit,2)} GP</span>
                                  <span style={{color:'var(--text-dim)'}}>{fmtP(li.marginPct)} margin</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div>
                            <div style={{fontSize:11,color:'var(--text-dim)',marginBottom:8,textTransform:'uppercase',letterSpacing:0.6}}>Order P&amp;L Breakdown</div>
                            {[
                              {l:'Product Revenue',  v:fmt(o.productRevenue,2),              c:'var(--green)'},
                              {l:'Shipping Collected',v:o.shippingCollected>0?`+${fmt(o.shippingCollected,2)}`:'$0.00', c:o.shippingCollected>0?'var(--green)':'var(--text-dim)'},
                              {l:'Refund',            v:o.refund>0?`−${fmt(o.refund,2)}`:'—', c:o.refund>0?'var(--red)':'var(--text-dim)'},
                              {l:'COGS',              v:`−${fmt(o.totalCOGS,2)}`,              c:'var(--red)'},
                              {l:'3PL Pick',          v:`−${fmt(o.fees?.threepl,2)}`,          c:'var(--red)'},
                              {l:'Packaging',         v:`−${fmt(o.fees?.packaging,2)}`,        c:'var(--red)'},
                              {l:'Processing',        v:`−${fmt(o.fees?.processing,2)}`,       c:'var(--red)'},
                              {l:'Postage',           v:o.postageCost>0?`−${fmt(o.postageCost,2)}`:'—', c:o.postageCost>0?'var(--red)':'var(--text-dim)'},
                              {l:'Net Profit',        v:fmt(o.netProfit,2),                    c:o.netProfit>=0?'var(--green)':'var(--red)',bold:true},
                            ].map(({l,v,c,bold})=>(
                              <div key={l} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'5px 0',borderBottom:'1px solid var(--border)'}}>
                                <span style={{color:'var(--text-dim)',fontWeight:bold?600:400}}>{l}</span>
                                <span style={{color:c,fontWeight:bold?700:500}}>{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
            {sorted.length>0 && (() => {
              const t = sorted.reduce((a,o)=>({
                rev:  a.rev  + o.grossRevenue,
                cogs: a.cogs + o.totalCOGS,
                fees: a.fees + (o.fees?.total||0) + (o.postageCost||0),
                np:   a.np   + o.netProfit,
                sm:   a.sm   + (o.shippingMargin||0),
              }),{rev:0,cogs:0,fees:0,np:0,sm:0})
              const am = sorted.reduce((s,o)=>s+o.netMarginPct,0)/sorted.length
              return (
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{padding:'10px 12px',fontSize:12,color:'var(--text-dim)',fontWeight:700}}>Totals · {sorted.length} orders</td>
                    <td style={{textAlign:'right',padding:'10px 12px',fontWeight:700}}>{fmt(t.rev,2)}</td>
                    <td style={{textAlign:'right',padding:'10px 12px',color:'var(--red)',fontWeight:700}}>−{fmt(t.cogs,2)}</td>
                    <td style={{textAlign:'right',padding:'10px 12px',color:'var(--red)',fontWeight:700}}>−{fmt(t.fees,2)}</td>
                    <td style={{textAlign:'right',padding:'10px 12px'}}><Pill value={t.np}/></td>
                    <td style={{textAlign:'right',padding:'10px 12px'}}><MBar pct={am}/></td>
                    <td style={{textAlign:'right',padding:'10px 12px',fontSize:12,color:t.sm>=0?'var(--green)':'var(--red)',fontWeight:700}}>{t.sm>=0?'+':''}{fmt(t.sm,2)}</td>
                    <td/>
                  </tr>
                </tfoot>
              )
            })()}
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── PRODUCTS TAB ─────────────────────────────────────────────────────────────
function ProductsTab({ skuBreakdown }) {
  const [view, setView] = useState('margin') // margin | revenue | units

  if (!skuBreakdown?.length) return <div className="card" style={{textAlign:'center',padding:40,color:'var(--text-dim)'}}>No product data</div>

  const totalRev  = skuBreakdown.reduce((s,sk)=>s+sk.revenue,0)
  const totalCOGS = skuBreakdown.reduce((s,sk)=>s+sk.cogs,0)
  const totalGP   = skuBreakdown.reduce((s,sk)=>s+sk.grossProfit,0)
  const totalUnits= skuBreakdown.reduce((s,sk)=>s+sk.qty,0)
  const blendedGM = totalRev>0?(totalGP/totalRev)*100:0

  const cats = {}
  skuBreakdown.forEach(sk=>{ const c=sk.category||'Other'; if(!cats[c])cats[c]=[]; cats[c].push(sk) })

  const sortedSkus = view==='margin'
    ? [...skuBreakdown].filter(s=>s.unitCost>0).sort((a,b)=>b.marginPct-a.marginPct)
    : view==='units'
    ? [...skuBreakdown].sort((a,b)=>b.qty-a.qty)
    : [...skuBreakdown].sort((a,b)=>b.revenue-a.revenue)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:20}}>

      {/* Summary KPIs */}
      <div className="kpi-grid-4">
        {[
          {l:'Total Revenue',  v:fmt(totalRev,2),  c:'var(--green)',   sub:'Product revenue only'},
          {l:'Total COGS',     v:fmt(totalCOGS,2), c:'var(--red)',     sub:'Manufacturing cost'},
          {l:'Gross Profit',   v:fmt(totalGP,2),   c:totalGP>=0?'var(--green)':'var(--red)', sub:'Before fees & overhead'},
          {l:'Blended GM',     v:fmtP(blendedGM),  c:blendedGM>=60?'var(--green)':blendedGM>=40?'var(--yellow)':'var(--red)', sub:'Gross margin across all SKUs'},
        ].map(({l,v,c,sub})=>(
          <div key={l} className="kcard">
            <div className="kcard-label">{l}</div>
            <div style={{fontSize:22,fontWeight:800,color:c,margin:'6px 0'}}>{v}</div>
            <div className="kcard-sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* SKU comparison chart */}
      <div className="card">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <SectionHead title="SKU Comparison"/>
          <div style={{display:'flex',gap:4}}>
            {['revenue','units','margin'].map(v=>(
              <button key={v} onClick={()=>setView(v)}
                style={{
                  padding:'4px 10px',borderRadius:20,fontSize:11,cursor:'pointer',border:'1px solid',
                  background:view===v?'var(--purple-dim)':'transparent',
                  borderColor:view===v?'var(--purple)':'var(--border)',
                  color:view===v?'var(--purple-light)':'var(--text-dim)',
                }}>
                {v.charAt(0).toUpperCase()+v.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <HBar
          items={sortedSkus.map(sk=>({
            ...sk,
            name: sk.name,
            revenue: sk.revenue,
            qty: sk.qty,
            marginPct: sk.marginPct,
            [view]: view==='margin'?sk.marginPct:view==='units'?sk.qty:sk.revenue,
          }))}
          valueKey={view}
          colorFn={(item)=>item.marginPct>=60?'var(--green)':item.marginPct>=40?'var(--purple)':'var(--yellow)'}
        />
      </div>

      {/* Margin vs Revenue scatter (table form) */}
      <div className="card" style={{padding:0,overflow:'hidden'}}>
        <div style={{padding:'14px 20px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <SectionHead title="Full SKU P&L Matrix"/>
          <span style={{fontSize:11,color:'var(--text-dim)'}}>Blended gross margin: {fmtP(blendedGM)}</span>
        </div>
        <div className="table-wrap"><table className="data-table">
          <thead>
            <tr>
              <th>Product</th>
              <th style={{textAlign:'right'}}>Units</th>
              <th style={{textAlign:'right'}}>Unit Price</th>
              <th style={{textAlign:'right'}}>Unit COGS</th>
              <th style={{textAlign:'right'}}>Unit GP</th>
              <th style={{textAlign:'right'}}>Revenue</th>
              <th style={{textAlign:'right'}}>COGS</th>
              <th style={{textAlign:'right'}}>Gross Profit</th>
              <th style={{textAlign:'right'}}>Margin</th>
              <th style={{textAlign:'right'}}>Rev Mix</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(cats).map(([cat, skus])=>[
              <tr key={`cat-${cat}`}>
                <td colSpan={10} style={{background:'var(--surface2)',padding:'6px 12px',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:0.6,color:'var(--text-dim)'}}>
                  {cat} — {fmt(skus.reduce((s,sk)=>s+sk.revenue,0),2)} revenue · {fmtP(skus.reduce((s,sk)=>s+sk.revenue,0)>0?(skus.reduce((s,sk)=>s+sk.grossProfit,0)/skus.reduce((s,sk)=>s+sk.revenue,0))*100:0)} blended margin
                </td>
              </tr>,
              ...[...skus].sort((a,b)=>b.revenue-a.revenue).map(sk=>(
                <tr key={sk.sku}>
                  <td>
                    <div style={{fontWeight:600,fontSize:13}}>{sk.name}</div>
                    <div style={{fontSize:10,color:'var(--text-dim)',marginTop:1}}>{sk.sku}</div>
                  </td>
                  <td style={{textAlign:'right'}}>{fmtN(sk.qty)}</td>
                  <td style={{textAlign:'right'}}>{fmt(sk.unitPrice,2)}</td>
                  <td style={{textAlign:'right',color:'var(--text-dim)'}}>{sk.unitCost>0?fmt(sk.unitCost,2):'—'}</td>
                  <td style={{textAlign:'right'}}>{sk.unitCost>0?<Pill value={sk.unitPrice-sk.unitCost}/>:'—'}</td>
                  <td style={{textAlign:'right',color:'var(--green)',fontWeight:600}}>{fmt(sk.revenue,2)}</td>
                  <td style={{textAlign:'right',color:'var(--red)'}}>{sk.unitCost>0?fmt(sk.cogs,2):'—'}</td>
                  <td style={{textAlign:'right'}}>{sk.unitCost>0?<Pill value={sk.grossProfit}/>:'—'}</td>
                  <td style={{textAlign:'right'}}><MBar pct={sk.unitCost>0?sk.marginPct:null}/></td>
                  <td style={{textAlign:'right'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:6}}>
                      <div style={{width:50,height:4,background:'var(--surface2)',borderRadius:2,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${totalRev>0?(sk.revenue/totalRev)*100:0}%`,background:'var(--purple)',borderRadius:2}}/>
                      </div>
                      <span style={{fontSize:11,color:'var(--text-dim)',minWidth:32,textAlign:'right'}}>{fmtP((sk.revenue/totalRev)*100,0)}</span>
                    </div>
                  </td>
                </tr>
              ))
            ])}
          </tbody>
        </table></div>
      </div>
    </div>
  )
}

// ─── ADS TAB ──────────────────────────────────────────────────────────────────
function AdsTab({ metaData, curr }) {
  const ad = metaData?.spend||0
  const isMock = metaData?.isMock

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      {isMock && (
        <div className="alert-warn">
          ⚠️ Showing placeholder data. Add <code>VITE_META_ACCESS_TOKEN</code> and <code>VITE_META_AD_ACCOUNT_ID</code> in Vercel env vars to connect real Meta Ads.
        </div>
      )}

      <div className="kpi-grid-4">
        {[
          {l:'Ad Spend',    v:ad>0?fmt(ad,2):'—',   accent:'var(--purple)'},
          {l:'ROAS',        v:metaData?.roas!=null?`${metaData.roas.toFixed(2)}×`:'—', accent:metaData?.roas>=2?'var(--green)':metaData?.roas>=1?'var(--yellow)':'var(--red)'},
          {l:'Impressions', v:metaData?.impressions!=null?fmtN(metaData.impressions):'—'},
          {l:'Clicks',      v:metaData?.clicks!=null?fmtN(metaData.clicks):'—'},
        ].map(({l,v,accent})=>(
          <div key={l} className="kcard" style={accent?{borderTopColor:accent}:{}}>
            <div className="kcard-label">{l}</div>
            <div className="kcard-value" style={{fontSize:24}}>{v}</div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <SectionHead title="Meta Ads Performance"/>
          <div style={{marginTop:12}}>
            {[
              {l:'CPC (Cost per Click)',       v:metaData?.cpc !=null?fmt(metaData.cpc,2):'—'},
              {l:'CPM (per 1,000 impr.)',      v:metaData?.cpm !=null?fmt(metaData.cpm,2):'—'},
              {l:'CTR (Click-through Rate)',   v:metaData?.ctr !=null?fmtP(metaData.ctr):'—'},
              {l:'ROAS',                       v:metaData?.roas!=null?`${metaData.roas.toFixed(2)}×`:'—'},
              {l:'Impressions',                v:metaData?.impressions!=null?fmtN(metaData.impressions):'—'},
              {l:'Clicks',                     v:metaData?.clicks!=null?fmtN(metaData.clicks):'—'},
            ].map(({l,v})=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--border)',fontSize:13}}>
                <span style={{color:'var(--text-dim)'}}>{l}</span>
                <span style={{fontWeight:600,color:'var(--purple)'}}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          <div className="card">
            <SectionHead title="Ad Efficiency vs Revenue"/>
            <div style={{marginTop:12}}>
              {curr && [
                {l:'Net Revenue',        v:fmt(curr.netRevenue,2),              c:'var(--green)'},
                {l:'Ad Spend',           v:ad>0?`−${fmt(ad,2)}`:'—',            c:'var(--red)'},
                {l:'Revenue ex-Ads',     v:fmt(curr.netRevenue-ad,2),           c:(curr.netRevenue-ad)>=0?'var(--green)':'var(--red)'},
                {l:'ROAS',               v:metaData?.roas!=null?`${metaData.roas.toFixed(2)}×`:'—', c:'var(--purple)'},
                {l:'Ad Cost per Order',  v:curr.orderCount>0?fmt(ad/curr.orderCount,2):'—', c:'var(--text-dim)'},
                {l:'Ad % of Revenue',    v:curr.netRevenue>0?fmtP((ad/curr.netRevenue)*100):'—', c:ad/curr.netRevenue>.3?'var(--red)':'var(--yellow)'},
              ].map(({l,v,c})=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--border)',fontSize:13}}>
                  <span style={{color:'var(--text-dim)'}}>{l}</span>
                  <span style={{fontWeight:600,color:c}}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {metaData?.sparkline && (
            <div className="card">
              <SectionHead title="Weekly Ad Spend Trend"/>
              <div style={{marginTop:8}}>
                <Spark data={metaData.sparkline} h={60}/>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── CLAUDE Q&A ───────────────────────────────────────────────────────────────
function ClaudeQA({ financialData }) {
  const [q, setQ]         = useState('')
  const [res, setRes]     = useState(null)
  const [err, setErr]     = useState(null)
  const [loading, setLd]  = useState(false)

  const suggestions = [
    "What's my most profitable product?",
    'Am I profitable after all costs?',
    'Where am I losing the most money?',
    'What should I focus on to grow margin?',
  ]

  async function ask(text) {
    const t = text||q
    if (!t.trim()) return
    setLd(true); setRes(null); setErr(null)
    try { setRes(await askClaude(t.trim(), financialData)) }
    catch(e) { setErr(e.message||'Check Anthropic API key') }
    finally { setLd(false) }
  }

  return (
    <div className="card">
      <SectionHead title="Ask Claude" sub="AI-powered analysis of your business data"/>
      <div style={{display:'flex',gap:10,marginTop:12}}>
        <input className="qa-input" type="text" value={q} onChange={e=>setQ(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask()}}}
          placeholder="e.g. What's my biggest cost driver this week?" disabled={loading}/>
        <button className="btn-ask" onClick={()=>ask()} disabled={loading||!q.trim()}>
          {loading?'…':'Ask'}
        </button>
      </div>
      {!res&&!err&&!loading && (
        <div style={{marginTop:10,display:'flex',flexWrap:'wrap',gap:6}}>
          {suggestions.map(s=>(
            <button key={s} className="pill-btn" onClick={()=>{setQ(s);ask(s)}}>{s}</button>
          ))}
        </div>
      )}
      {loading && <div className="qa-thinking"><div className="thinking-dots"><span>·</span><span>·</span><span>·</span></div>Analyzing your data…</div>}
      {res && <div className="qa-response">{res}</div>}
      {err && <div className="qa-error"><strong>Error:</strong> {err}</div>}
    </div>
  )
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [shopify,     setShopify]   = useState(null)
  const [meta,        setMeta]      = useState(null)
  const [status,      setStatus]    = useState('idle')
  const [lastSynced,  setLastSync]  = useState(null)
  const [error,       setError]     = useState(null)
  const [tab,         setTab]       = useState('overview')
  const [preset,      setPreset]    = useState('this_week')
  const [showCustom,  setShowCustom] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd,   setCustomEnd]   = useState('')

  const ck  = p => `${CACHE_KEY}_${p}`
  const rdc = p => { try { const r=JSON.parse(localStorage.getItem(ck(p))||'null'); return r&&Date.now()-r.ts<CACHE_TTL_MS?r:null } catch{return null} }
  const wrc = (p,s,m) => { try { localStorage.setItem(ck(p),JSON.stringify({ts:Date.now(),shopify:s,meta:m})) } catch{} }

  const load = useCallback(async (force=false, p=preset, customRange=null) => {
    setStatus('loading'); setError(null)
    const cacheKey = customRange ? `custom_${customRange.start.toISOString().split('T')[0]}_${customRange.end.toISOString().split('T')[0]}` : p
    if (!force && !customRange) {
      const c = rdc(cacheKey)
      if (c) { setShopify(c.shopify); setMeta(c.meta); setLastSync(new Date(c.ts)); setStatus('done'); return }
    }
    try {
      const s = await getShopifyData(p, customRange)
      const m = await getMetaData(s.current?.netRevenue||0, s.current?.range)
      setShopify(s); setMeta(m); setLastSync(new Date())
      if (!customRange) wrc(cacheKey,s,m)
      setStatus('done')
    } catch(e) { setError(e.message); setStatus('error') }
  }, [preset])

  const applyCustomRange = () => {
    if (!customStart || !customEnd) return
    const start = new Date(customStart + 'T00:00:00')
    const end   = new Date(customEnd   + 'T23:59:59')
    if (start > end) return
    setShowCustom(false)
    load(true, preset, { start, end, label: `${customStart} → ${customEnd}` })
  }

  useEffect(() => { load(false, preset) }, [preset])

  const curr  = shopify?.current
  const prev  = shopify?.prior
  const isMock = curr?.isMock || meta?.isMock
  const totalMonthlyFixed = Object.values(MONTHLY_FIXED).reduce((s,v)=>s+v,0)
  const weeklyFixed = totalMonthlyFixed / 4.33
  const rangeLabel = curr?.range?.label || 'This Period'

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <div className="logo">Hide <span>Tallow</span></div>
          <div className="logo-sub">Financial Command Center</div>
          {isMock && <span className="mock-badge">SAMPLE DATA</span>}
        </div>
        <div className="header-right">
          <div className="sync-info">
            <span className={`sync-dot ${status==='loading'?'loading':status==='error'?'error':''}`}/>
            {status==='loading'?'Syncing…':status==='error'?'Error':lastSynced?`${lastSynced.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:'—'}
          </div>
          <button className="btn-sm" onClick={()=>load(true,preset)} disabled={status==='loading'}>↻ Refresh</button>
        </div>
      </header>

      {/* ── Preset bar ── */}
      <div className="preset-bar">
        {TIME_PRESETS.map(p=>(
          <button key={p.id} className={`preset-btn${preset===p.id&&!showCustom?' active':''}`}
            onClick={()=>{setShowCustom(false);setPreset(p.id)}} disabled={status==='loading'}>
            {p.label}
          </button>
        ))}
        <button className={`preset-btn${showCustom?' active':''}`} onClick={()=>setShowCustom(v=>!v)} disabled={status==='loading'}>
          Custom
        </button>
        {curr && !showCustom && <span className="range-label">{rangeLabel}</span>}
      </div>

      {/* ── Custom date picker ── */}
      {showCustom && (
        <div className="custom-date-bar">
          <span className="custom-date-label">From</span>
          <input type="date" className="date-input" value={customStart} onChange={e=>setCustomStart(e.target.value)} max={customEnd||undefined}/>
          <span className="custom-date-label">To</span>
          <input type="date" className="date-input" value={customEnd} onChange={e=>setCustomEnd(e.target.value)} min={customStart||undefined}/>
          <button className="btn-sm" onClick={applyCustomRange} disabled={!customStart||!customEnd||status==='loading'}>Apply</button>
          <button className="btn-sm" onClick={()=>setShowCustom(false)}>✕</button>
        </div>
      )}

      {/* ── Tab bar (desktop) ── */}
      <div className="tab-bar tab-bar-desktop">
        {TABS.map(t=>(
          <button key={t.id} className={`tab-btn${tab===t.id?' active':''}`} onClick={()=>setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ── Loading ── */}
      {status==='loading'&&!curr&&(
        <div className="loading-overlay"><div className="spinner"/><span>Loading {rangeLabel}…</span></div>
      )}
      {status==='error'&&!curr&&(
        <div className="loading-overlay">
          <div style={{fontSize:32}}>⚠️</div>
          <span style={{color:'var(--red)'}}>{error}</span>
          <button className="btn-sm" onClick={()=>load(true,preset)}>Retry</button>
        </div>
      )}

      {/* ── Progress bar ── */}
      {status==='loading'&&curr&&(
        <div style={{position:'fixed',top:0,left:0,right:0,height:2,background:'var(--purple)',zIndex:999,animation:'progressBar 1.5s ease-in-out infinite'}}/>
      )}

      {/* ── Content ── */}
      {curr && (
        <main className="main">
          {tab==='overview' && <OverviewTab curr={curr} prev={prev} metaData={meta} weeklyFixed={weeklyFixed} totalMonthlyFixed={totalMonthlyFixed} shopifyData={shopify}/>}
          {tab==='pnl'      && <PnLTab      curr={curr} metaData={meta} weeklyFixed={weeklyFixed} totalMonthlyFixed={totalMonthlyFixed} rangeLabel={rangeLabel}/>}
          {tab==='orders'   && <OrdersTab   enrichedOrders={curr.enrichedOrders}/>}
          {tab==='products' && <ProductsTab skuBreakdown={curr.skuBreakdown}/>}
          {tab==='ads'      && <AdsTab      metaData={meta} curr={curr}/>}
        </main>
      )}

      <footer className="footer footer-desktop">
        Hide Tallow · Financial Command Center · {rangeLabel} {isMock&&'· ⚠ Sample Data'}
      </footer>

      {/* ── Mobile bottom nav ── */}
      <nav className="bottom-nav">
        {TABS.map(t=>(
          <button key={t.id} className={`bottom-nav-btn${tab===t.id?' active':''}`} onClick={()=>setTab(t.id)}>
            <span className="bottom-nav-icon">{t.icon}</span>
            <span className="bottom-nav-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

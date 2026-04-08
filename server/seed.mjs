import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

async function seed() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  console.log("Connected to DB");

  // Clear existing data
  const tables = ["weekly_reports","daily_summaries","recommendations","funnel_bottlenecks","sales_activities","ad_insights","leads","ads","ad_sets","campaigns","sales_agents","ads_accounts"];
  for (const t of tables) { await connection.execute(`DELETE FROM \`${t}\``); }
  console.log("Cleared tables");

  // Ads Accounts
  await connection.execute(`INSERT INTO ads_accounts (accountId,name,currency,timezone,status) VALUES ('act_100001','Main Education Account','USD','Africa/Cairo','active'),('act_100002','Gulf Region Account','AED','Asia/Dubai','active')`);

  // Campaigns
  await connection.execute(`INSERT INTO campaigns (campaignId,accountId,name,objective,status,dailyBudget,totalSpend,country,startDate) VALUES
    ('camp_001',1,'Egypt - Course Launch Q1','LEAD_GENERATION','active',150.00,12450.00,'Egypt',DATE_SUB(NOW(),INTERVAL 30 DAY)),
    ('camp_002',1,'Egypt - Retargeting Warm','CONVERSIONS','active',80.00,6200.00,'Egypt',DATE_SUB(NOW(),INTERVAL 30 DAY)),
    ('camp_003',2,'UAE - Premium Course','LEAD_GENERATION','active',200.00,15800.00,'UAE',DATE_SUB(NOW(),INTERVAL 30 DAY)),
    ('camp_004',2,'KSA - Business Skills','LEAD_GENERATION','active',120.00,9600.00,'KSA',DATE_SUB(NOW(),INTERVAL 30 DAY)),
    ('camp_005',1,'Egypt - Free Webinar','REACH','paused',50.00,3200.00,'Egypt',DATE_SUB(NOW(),INTERVAL 30 DAY)),
    ('camp_006',2,'Qatar - Executive MBA','LEAD_GENERATION','active',180.00,7400.00,'Qatar',DATE_SUB(NOW(),INTERVAL 30 DAY))`);

  // Ad Sets
  await connection.execute(`INSERT INTO ad_sets (adSetId,campaignId,name,status,bidStrategy,dailyBudget) VALUES
    ('adset_001',1,'Egypt 25-35 Interest','active','LOWEST_COST',75.00),
    ('adset_002',1,'Egypt 35-45 Lookalike','active','COST_CAP',75.00),
    ('adset_003',2,'Egypt Retarget Visitors','active','LOWEST_COST',80.00),
    ('adset_004',3,'UAE 30-50 Business','active','COST_CAP',100.00),
    ('adset_005',3,'UAE Lookalike','active','LOWEST_COST',100.00),
    ('adset_006',4,'KSA 25-40 Education','active','LOWEST_COST',60.00),
    ('adset_007',4,'KSA Broad Interest','active','COST_CAP',60.00),
    ('adset_008',6,'Qatar Executives','active','COST_CAP',180.00)`);

  // Ads
  await connection.execute(`INSERT INTO ads (adId,adSetId,name,status,creativeType) VALUES
    ('ad_001',1,'Video - Success Story Ahmed','active','video'),
    ('ad_002',1,'Carousel - Course Modules','active','carousel'),
    ('ad_003',2,'Image - Testimonial','active','image'),
    ('ad_004',3,'Video - Retarget Offer','active','video'),
    ('ad_005',4,'Video - UAE Premium','active','video'),
    ('ad_006',5,'Image - UAE Lookalike','active','image'),
    ('ad_007',6,'Carousel - KSA Skills','active','carousel'),
    ('ad_008',7,'Video - KSA Broad','paused','video'),
    ('ad_009',8,'Video - Qatar MBA','active','video')`);
  console.log("Inserted campaigns/ads");

  // Ad Insights - batch by campaign
  const insightRows = [];
  const campMetrics = [
    {id:1,spend:145,imp:18000,clk:540,leads:22,conv:3,rev:450,country:'Egypt'},
    {id:2,spend:78,imp:8000,clk:320,leads:8,conv:2,rev:380,country:'Egypt'},
    {id:3,spend:195,imp:12000,clk:360,leads:14,conv:5,rev:1200,country:'UAE'},
    {id:4,spend:115,imp:10000,clk:280,leads:12,conv:3,rev:600,country:'KSA'},
    {id:5,spend:48,imp:15000,clk:200,leads:5,conv:1,rev:100,country:'Egypt'},
    {id:6,spend:175,imp:8000,clk:240,leads:8,conv:4,rev:1600,country:'Qatar'},
  ];
  for (let day=29;day>=0;day--) {
    for (const m of campMetrics) {
      const sp=(m.spend+(Math.random()*20-10)).toFixed(2);
      const imp=m.imp+Math.floor(Math.random()*3000-1500);
      const clk=m.clk+Math.floor(Math.random()*80-40);
      const leads=Math.max(1,m.leads+Math.floor(Math.random()*6-3));
      const conv=Math.max(0,m.conv+Math.floor(Math.random()*3-1));
      const rev=(m.rev+(Math.random()*200-100)).toFixed(2);
      const ctr=((clk/imp)*100).toFixed(4);
      const cpc=(sp/clk).toFixed(2);
      const cpm=((sp/imp)*1000).toFixed(2);
      const cpl=(sp/leads).toFixed(2);
      const reach=Math.floor(imp*0.75);
      const freq=(imp/reach).toFixed(2);
      insightRows.push(`(${m.id},DATE_SUB(NOW(),INTERVAL ${day} DAY),${sp},${imp},${clk},${ctr},${cpc},${cpm},${leads},${cpl},${reach},${freq},${conv},${rev},'${m.country}')`);
    }
  }
  // Insert in chunks of 60
  for (let i=0;i<insightRows.length;i+=60) {
    const chunk=insightRows.slice(i,i+60).join(',');
    await connection.execute(`INSERT INTO ad_insights (campaignId,date,spend,impressions,clicks,ctr,cpc,cpm,leads,costPerLead,reach,frequency,conversions,revenue,country) VALUES ${chunk}`);
  }
  console.log("Inserted ad insights");

  // Sales Agents
  await connection.execute(`INSERT INTO sales_agents (name,email,phone,team,status,avgResponseTime,totalLeads,totalConversions,conversionRate,totalRevenue,followUpRate) VALUES
    ('Ahmed Hassan','ahmed@company.com','+201001234567','Team A','active',180,245,32,13.06,48200.00,82.50),
    ('Sara Mohamed','sara@company.com','+201001234568','Team A','active',120,280,45,16.07,67500.00,91.20),
    ('Omar Ali','omar@company.com','+201001234569','Team B','active',420,190,8,4.21,12000.00,45.30),
    ('Fatima Khalid','fatima@company.com','+971501234567','Team B','active',90,160,38,23.75,95000.00,88.00),
    ('Youssef Nour','youssef@company.com','+966501234567','Team A','active',300,220,15,6.82,22500.00,62.00),
    ('Layla Ibrahim','layla@company.com','+974501234567','Team B','active',150,175,28,16.00,56000.00,78.50)`);

  // Leads - batch 200
  const leadRows=[];
  const statuses=['new','contacted','qualified','unqualified','converted','lost'];
  const intents=['high','medium','low'];
  const countries=['Egypt','UAE','KSA','Qatar'];
  for (let i=0;i<200;i++) {
    const country=countries[i%4];
    const status=statuses[i%6];
    const intent=intents[i%3];
    const isFake=i%13===0?1:0;
    const score=intent==='high'?70+Math.floor(Math.random()*30):intent==='medium'?40+Math.floor(Math.random()*30):10+Math.floor(Math.random()*30);
    const agentId=(i%6)+1;
    const campId=(i%6)+1;
    const rt=60+Math.floor(Math.random()*1800);
    const daysAgo=Math.floor(Math.random()*30);
    leadRows.push(`(${campId},'meta_ads','${country}','+2010010${String(i).padStart(5,'0')}','Lead ${i+1}','${status}','${intent}',${score},${isFake},${agentId},${rt},DATE_SUB(NOW(),INTERVAL ${daysAgo} DAY))`);
  }
  for (let i=0;i<leadRows.length;i+=50) {
    const chunk=leadRows.slice(i,i+50).join(',');
    await connection.execute(`INSERT INTO leads (campaignId,source,country,phone,name,status,intentLevel,leadScore,isFake,assignedAgentId,responseTimeSeconds,createdAt) VALUES ${chunk}`);
  }
  console.log("Inserted leads");

  // Sales Activities - batch 300
  const actRows=[];
  const actTypes=['call','message','follow_up','email','meeting','close'];
  const outcomes=['answered','no_answer','interested','not_interested','scheduled','closed_won','closed_lost'];
  for (let i=0;i<300;i++) {
    const agentId=(i%6)+1;
    const leadId=(i%200)+1;
    const type=actTypes[i%6];
    const outcome=outcomes[i%7];
    const dur=30+Math.floor(Math.random()*300);
    const daysAgo=Math.floor(Math.random()*30);
    actRows.push(`(${agentId},${leadId},'${type}','${outcome}',${dur},DATE_SUB(NOW(),INTERVAL ${daysAgo} DAY))`);
  }
  for (let i=0;i<actRows.length;i+=60) {
    const chunk=actRows.slice(i,i+60).join(',');
    await connection.execute(`INSERT INTO sales_activities (agentId,leadId,type,outcome,duration,createdAt) VALUES ${chunk}`);
  }
  console.log("Inserted activities");

  // Funnel Bottlenecks
  await connection.execute(`INSERT INTO funnel_bottlenecks (stage,severity,title,description,metric,currentValue,benchmarkValue,revenueImpact,country) VALUES
    ('ads','critical','High CPL in Egypt Campaign','Cost per lead in Egypt Course Launch Q1 is $6.59, 32% above benchmark','costPerLead',6.59,5.00,4200.00,'Egypt'),
    ('leads','warning','Low Lead Quality from KSA Broad','38% of leads from KSA Broad Interest are unqualified','qualifiedRate',62.00,80.00,3800.00,'KSA'),
    ('sales','critical','Agent Omar - Low Conversion','Omar Ali conversion rate 4.21% vs team avg 13.49%','conversionRate',4.21,13.49,8500.00,NULL),
    ('sales','warning','Slow Response Time','Average first response 4.2 min, benchmark 2 min','responseTime',252,120,6200.00,NULL),
    ('leads','critical','8% Fake Lead Rate Detected','16 of 200 leads flagged as fake from Egypt campaigns','fakeRate',8.00,2.00,2400.00,'Egypt'),
    ('revenue','warning','Qatar Revenue Below Forecast','Qatar revenue 18% below weekly forecast','revenue',6400.00,7800.00,1400.00,'Qatar'),
    ('ads','info','UAE Campaign Scaling Opportunity','UAE Premium Course has 23.75% conversion rate','conversionRate',23.75,15.00,NULL,'UAE'),
    ('funnel','critical','Egypt Funnel Leak','Egypt generates 55% of leads but only 28% of revenue','funnelEfficiency',28.00,55.00,12000.00,'Egypt')`);

  // Recommendations
  await connection.execute(`INSERT INTO recommendations (category,priority,title,problem,reason,action,estimatedImpact) VALUES
    ('sales','critical','Retrain Agent Omar Ali','Omar Ali has 4.21% conversion rate vs team avg 13.49%','Not following sales script, longest avg response time (420s)','Schedule 1-on-1 coaching, pair with Sara for shadowing, set daily conversion targets',8500.00),
    ('ads','critical','Pause Egypt Low-Quality Ad Sets','Egypt Broad targeting generating 38% unqualified leads','Broad targeting attracting non-serious inquiries, wasting budget','Pause adset_002, reallocate $75/day to lookalike audiences with 2.3x better quality',4200.00),
    ('leads','high','Implement 2-Minute Response SLA','Avg response 4.2 min, leads contacted within 2 min convert 3x better','No automated lead routing, agents manually check for new leads','Deploy automated lead assignment with push notifications, set 2-min SLA with escalation',6200.00),
    ('sales','high','Increase Follow-Up Rate','Team avg follow-up rate 74.6%, benchmark 90%','No structured follow-up cadence, agents rely on memory','Implement automated follow-up reminders at 24h, 48h, 72h for unconverted leads',3200.00),
    ('ads','medium','Scale UAE Premium Campaign','UAE Premium Course has 23.75% conversion rate and $1200+ daily revenue','Strong product-market fit, high-intent audience in UAE','Increase daily budget from $200 to $350, duplicate winning ad sets',5600.00),
    ('funnel','high','Fix Egypt Funnel Leak','Egypt generates 55% of leads but only 28% of revenue','Combination of low lead quality and poor sales follow-through','1) Tighten Egypt targeting 2) Assign top agents to Egypt leads 3) Egypt-specific script',12000.00),
    ('leads','medium','Deploy Fake Lead Detection','8% of leads flagged as potentially fake, wasting agent time','No automated validation of phone/email at capture','Add phone OTP validation, email verification, auto-flag suspicious patterns',2400.00),
    ('ads','low','A/B Test New Creatives for KSA','KSA campaign CTR declined 15% over past 2 weeks','Creative fatigue - same video running for 45 days','Create 3 new video variations, test carousel format, refresh copy with KSA references',1800.00)`);
  console.log("Inserted bottlenecks & recommendations");

  // Daily Summaries
  const dsRows=[];
  for (let day=6;day>=0;day--) {
    const sp=(750+Math.random()*100).toFixed(2);
    const rev=(3200+Math.random()*800).toFixed(2);
    const leads=65+Math.floor(Math.random()*15);
    const conv=15+Math.floor(Math.random()*8);
    const cpl=(sp/leads).toFixed(2);
    const cr=((conv/leads)*100).toFixed(2);
    const lost=(800+Math.random()*400).toFixed(2);
    const alerts=JSON.stringify([{type:'critical',message:'Agent Omar missed 5 follow-ups'},{type:'warning',message:'Egypt CPL increased by 12%'},{type:'info',message:'UAE campaign hit daily budget cap'}]).replace(/'/g,"\\'");
    const summary=`Revenue $${rev} from $${sp} spend (${(rev/sp).toFixed(1)}x ROAS). ${leads} leads, ${conv} conversions. $${lost} estimated revenue lost.`.replace(/'/g,"\\'");
    dsRows.push(`(DATE_SUB(NOW(),INTERVAL ${day} DAY),${sp},${rev},${leads},${conv},${cpl},${cr},${lost},'${alerts}','${summary}')`);
  }
  await connection.execute(`INSERT INTO daily_summaries (date,totalSpend,totalRevenue,totalLeads,totalConversions,avgCostPerLead,avgConversionRate,revenueLost,keyAlerts,aiSummary) VALUES ${dsRows.join(',')}`);

  // Weekly Reports
  const wrRows=[];
  for (let week=3;week>=0;week--) {
    const sp=(5200+Math.random()*500).toFixed(2);
    const rev=(22000+Math.random()*3000).toFixed(2);
    const leads=450+Math.floor(Math.random()*80);
    const conv=110+Math.floor(Math.random()*30);
    const rg=(-5+Math.random()*15).toFixed(2);
    const lg=(-3+Math.random()*12).toFixed(2);
    const recs=JSON.stringify(['Retrain Agent Omar - $8,500 impact','Scale UAE Premium - $5,600 opportunity','Fix Egypt funnel leak - $12,000 at stake']).replace(/'/g,"\\'");
    const sum=`Week ${4-week}: Revenue $${rev} (${rg>0?'+':''}${rg}% vs prev). ${leads} leads, ${conv} converted. ROAS: ${(rev/sp).toFixed(1)}x.`.replace(/'/g,"\\'");
    wrRows.push(`(DATE_SUB(NOW(),INTERVAL ${week} WEEK),DATE_SUB(NOW(),INTERVAL ${week*7-6} DAY),${sp},${rev},${leads},${conv},${rg},${lg},'${recs}','${sum}')`);
  }
  await connection.execute(`INSERT INTO weekly_reports (weekStart,weekEnd,totalSpend,totalRevenue,totalLeads,totalConversions,revenueGrowth,leadGrowth,topRecommendations,summary) VALUES ${wrRows.join(',')}`);

  console.log("✅ Seed complete!");
  await connection.end();
  process.exit(0);
}

seed().catch(e=>{ console.error("Seed failed:",e.message); process.exit(1); });

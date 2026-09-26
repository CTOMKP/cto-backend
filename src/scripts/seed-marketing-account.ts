import { CreatorEarningType, PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const email = 'ctomarketplace1@gmail.com';
const did = 'did:privy:cmjfzv2ox03efju0cv1hpdf1k';
const solana = 'Eifi91GDQLi19Gp4RBMHBSGeTeWNJibno9ZumdvBUArA';
const marker = 'cto-marketing-demo-v1';
const ago = (d:number) => new Date(Date.now()-d*86400000);
const raw = (n:number) => String(n*1_000_000);
async function main(){
 if(process.env.CONFIRM_MARKETING_SEED!=='SEED_CTO1_MARKETING_ACCOUNT') throw new Error('Missing CONFIRM_MARKETING_SEED=SEED_CTO1_MARKETING_ACCOUNT');
 const user=await db.user.findUnique({where:{email},include:{wallets:true}});
 if(!user||(user.privyDid!==did&&user.privyUserId!==did)) throw new Error('Target email/Privy identity mismatch');
 const wallet=user.wallets.find(w=>w.blockchain==='SOLANA'&&w.address===solana);
 if(!wallet) throw new Error('Expected Solana wallet is not owned by target user');
 const credits=[750,1250,900,1600,2100], debits=[180,250,320,400,275,510,640,295,375,480,540,700];
 for(const [kind,values] of [['CREDIT',credits],['DEBIT',debits]] as const) for(let i=0;i<values.length;i++){
  const txHash=`marketing-demo-${kind.toLowerCase()}-${i+1}`, date=ago(kind==='CREDIT'?82-i*11:74-i*6);
  await db.walletTransaction.upsert({where:{walletId_txHash:{walletId:wallet.id,txHash}},create:{walletId:wallet.id,txHash,txType:kind,amount:raw(values[i]),tokenAddress:'marketing-demo-usdc',tokenSymbol:'USDC',fromAddress:kind==='CREDIT'?'CTO Demo Treasury':solana,toAddress:kind==='CREDIT'?solana:'CTO Demo Treasury',status:'COMPLETED',blockTime:date,createdAt:date,description:`Marketing demo USDC ${kind.toLowerCase()}`,metadata:{marker,synthetic:true}},update:{amount:raw(values[i]),status:'COMPLETED'}});
 }
 const code='CTO1DEMO';
 const account=await db.creatorProgramAccount.upsert({where:{userId:user.id},create:{userId:user.id,referralCode:code,referralLink:`https://earn.ctomarketplace.com/?ref=${code}`,tier:'PARTNER',activeReferralsCount:37,totalReferralsCount:37,totalEarned:1500,pendingBalance:685,paidBalance:815,payoutWalletAddress:solana},update:{tier:'PARTNER',activeReferralsCount:37,totalReferralsCount:37,totalEarned:1500,pendingBalance:685,reservedBalance:0,paidBalance:815,heldBalance:0,payoutWalletAddress:solana}});
 const referred=[];
 for(let i=1;i<=37;i++){const s=String(i).padStart(2,'0'); const u=await db.user.upsert({where:{email:`creator-referral-${s}@marketing.cto.invalid`},create:{email:`creator-referral-${s}@marketing.cto.invalid`,name:`CTO Community Member ${s}`,provider:'marketing_seed'},update:{name:`CTO Community Member ${s}`}}); await db.creatorReferral.upsert({where:{referredUserId:u.id},create:{creatorUserId:user.id,referredUserId:u.id,referralCode:code,referralSource:'marketing_demo',status:'ACTIVE',isActive:true,signedUpAt:ago(120-i*3),activatedAt:ago(118-i*3),firstQualifyingActionType:i%2?'MARKETPLACE_AD':'LISTING_FEE',metadata:{marker,synthetic:true}},update:{creatorUserId:user.id,status:'ACTIVE',isActive:true,metadata:{marker,synthetic:true}}}); referred.push(u);}
 const amounts=[45,65,80,55,90,75,110,95,130,70,120,85,140,100,125,115], types:CreatorEarningType[]=['LISTING_FEE','MARKETPLACE_AD','ESCROW_FEE','REVENUE_SHARE'];
 for(let i=0;i<amounts.length;i++){const eventKey=`${marker}-earning-${i+1}`,u=referred[i]; await db.creatorEarning.upsert({where:{eventKey},create:{creatorAccountId:account.id,creatorUserId:user.id,referredUserId:u.id,sourceType:types[i%4],sourceId:`${marker}-source-${i+1}`,amountGross:amounts[i]*5,platformFeeAmount:amounts[i],creatorCutPercent:20,amountEarned:amounts[i],status:i<10?'PAID':'AVAILABLE',eventKey,createdAt:ago(28-i),metadata:{marker,synthetic:true}},update:{amountEarned:amounts[i],status:i<10?'PAID':'AVAILABLE'}}); await db.creatorReferral.update({where:{referredUserId:u.id},data:{totalEarned:amounts[i]}});}
 for(const [i,amount] of [300,275,240].entries()){const m=`${marker}-payout-${i+1}`,data={creatorAccountId:account.id,creatorUserId:user.id,walletAddress:solana,amountRequested:amount,amountApproved:amount,status:'PAID' as const,txHash:`marketing-demo-payout-${i+1}`,requestNote:'Marketing demo referral payout',reviewedAt:ago(20-i*7),processedAt:ago(19-i*7),createdAt:ago(21-i*7),metadata:{marker:m,synthetic:true,chain:'solana'}}; const old=await db.creatorPayout.findFirst({where:{creatorUserId:user.id,metadata:{path:['marker'],equals:m}}}); old?await db.creatorPayout.update({where:{id:old.id},data}):await db.creatorPayout.create({data});}
 console.log({userId:user.id,totalDeposited:6600,totalPaidOut:4965,referrals:37,totalEarned:1500,paidBalance:815,pendingBalance:685});
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());

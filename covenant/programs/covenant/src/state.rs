use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Covenant {
    pub user: Pubkey,
    pub executor: Pubkey,
    pub collateral_amount: u64,
    pub compensation_cap: u64,
    pub constraint_hash: [u8; 32],
    pub deadline: i64,
    pub status: CovenantStatus,
    pub verdict: Option<bool>,
    pub bump: u8,
}

impl Covenant {
    pub const LEN: usize = 8 + Covenant::INIT_SPACE;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum CovenantStatus {
    Open,  
    Accepted,
    Settled,
}
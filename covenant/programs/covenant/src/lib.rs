use anchor_lang::prelude::*;

mod errors;
mod instructions;
pub mod state;
pub use state::Covenant;

use instructions::*;

declare_id!("Cb5yZqPKS9utNAf6LB3Cb4r36tMHpKtaY8LeNjtkwRAi");

#[program]
pub mod covenant {
    use super::*;

    pub fn create_covenant(
        ctx: Context<CreateCovenant>,
        constraint_hash: [u8; 32],
        compensation_cap: u64,
        deadline: i64,
    ) -> Result<()> {
        instructions::create::handler(ctx, constraint_hash, compensation_cap, deadline)
    }

    pub fn accept_covenant(ctx: Context<AcceptCovenant>, collateral_amount: u64) -> Result<()> {
        instructions::accept::handler(ctx, collateral_amount)
    }

    pub fn receive_verdict(
        ctx: Context<ReceiveVerdict>,
        user_pubkey: Pubkey,
        constraint_hash: [u8; 32],
        passed: bool,
    ) -> Result<()> {
        instructions::receive_verdict::handler(ctx, user_pubkey, constraint_hash, passed)
    }

    pub fn settle(ctx: Context<SettleCovenant>) -> Result<()> {
        instructions::settle::handler(ctx)
    }
}

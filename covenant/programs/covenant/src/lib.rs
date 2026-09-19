use anchor_lang::prelude::*;

mod state;
mod errors;
mod instructions;

use instructions::*;

declare_id!("BasyCwQqrLFVAXPrcL6LNE2t1YLxVRM4tM5ZnRAAhFUs");

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

    pub fn accept_covenant(
        ctx: Context<AcceptCovenant>,
        collateral_amount: u64
    ) -> Result<()> {
        instructions::accept::handler(ctx, collateral_amount)
    }

    pub fn receive_verdict(
        ctx: Context<ReceiveVerdict>,
        passed: bool
    ) ->Result<()> {
        instructions::receive_verdict::handler(ctx, passed)
    }
}
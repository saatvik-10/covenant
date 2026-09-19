use crate::errors::CovenantError;
use crate::state::{Covenant, CovenantStatus};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ReceiveVerdict<'info> {
    //LZ msg protocol
    #[account(mut)]
    pub covenant: Account<'info, Covenant>,
}

pub fn handler(ctx: Context<ReceiveVerdict>, passed: bool) -> Result<()> {
    let covenant = &mut ctx.accounts.covenant;

    require!(
        covenant.status == CovenantStatus::Accepted,
        CovenantError::NotAccepted
    );

    covenant.verdict = Some(passed);

    msg!("Verdict received for covenant: passed={}", passed);

    Ok(())
}

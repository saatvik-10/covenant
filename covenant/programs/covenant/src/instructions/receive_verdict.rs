use anchor_lang::prelude::*;
use crate::state::{Covenant, CovenantStatus};
use crate::errors::CovenantError;

#[derive(Accounts)]
pub struct ReceiveVerdict<'info> {
    //LZ msg protocol

    #[account(mut)]
    pub covenant: Account<'info,  Covenant>
}

pub fn handler(ctx: Context<ReceiveVerdict>, passed: bool) -> Result<()> {
    let covenant = &mut ctx.accounts.covenant;

    require!(covenant.status == CovenantStatus::Accepted, CovenantError::NotAccepted);

    covenant.verdict = Some(passed);

    msg!("Verdict received for covenant: passed={}", passed);
    
    Ok(())
}
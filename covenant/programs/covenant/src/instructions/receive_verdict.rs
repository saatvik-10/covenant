use crate::errors::CovenantError;
use crate::state::{Covenant, CovenantStatus};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(user_pubkey: Pubkey, constraint_hash: [u8; 32])]
pub struct ReceiveVerdict<'info> {
     pub oapp_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"covenant", user_pubkey.as_ref(), constraint_hash.as_ref()],
        bump = covenant.bump,
        constraint = covenant.status == CovenantStatus::Accepted @ CovenantError::NotAccepted,
    )]
    pub covenant: Account<'info, Covenant>,
}

pub fn handler(
    ctx: Context<ReceiveVerdict>,
    _user_pubkey: Pubkey,
    _constraint_hash: [u8; 32],
    passed: bool,
) -> Result<()> {
    let covenant = &mut ctx.accounts.covenant;
    covenant.verdict = Some(passed);

    msg!("Verdict received: passed={}", passed);

    Ok(())
}

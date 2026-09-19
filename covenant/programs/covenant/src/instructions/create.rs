use anchor_lang::prelude::*;
use crate::state::{Covenant, CovenantStatus};
use crate::errors::CovenantError;

#[derive(Accounts)]
#[instruction(constraint_hash: [u8; 32])]
pub struct CreateCovenant<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = Covenant::LEN,
        seeds = [b"covenant", user.key().as_ref(), constraint_hash.as_ref()],
        bump
    )]
    pub covenant: Account<'info, Covenant>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateCovenant>,
    constraint_hash: [u8; 32],
    compensation_cap: u64,
    deadline: i64,
) -> Result<()> {
    let clock = Clock::get()?;
    
    require!(deadline > clock.unix_timestamp, CovenantError::DeadlinePassed);

    let covenant = &mut ctx.accounts.covenant;

    covenant.user = ctx.accounts.user.key();
    covenant.executor = Pubkey::default();
    covenant.collateral_amount = 0;
    covenant.compensation_cap = compensation_cap;
    covenant.constraint_hash = constraint_hash;
    covenant.deadline = deadline;
    covenant.status = CovenantStatus::Open;
    covenant.verdict = None;
    covenant.bump = ctx.bumps.covenant;

    msg!("Covenant created: hash={:?}, deadline={}", constraint_hash, deadline);

    Ok(())
}
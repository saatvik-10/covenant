use anchor_lang::{prelude::*};
use crate::state::{Covenant, CovenantStatus};
use crate::errors::CovenantError;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use anchor_spl::associated_token::AssociatedToken;

#[derive(Accounts)]
pub struct AcceptCovenant<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"covenant", covenant.user.as_ref(), covenant.constraint_hash.as_ref()],
        bump = covenant.bump,
        constraint = covenant.status == CovenantStatus::Open @ CovenantError::NotOpen
    )]
    pub covenant: Account<'info, Covenant>,

    pub collateral_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = executor,
    )]
    pub executor_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = executor,
        associated_token::mint = collateral_mint,
        associated_token::authority = covenant,
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AcceptCovenant>, collateral_amount: u64) -> Result<()> {
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.executor_token_account.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.executor.to_account_info(),
            },
        ),
        collateral_amount,
    )?;

    let covenant = &mut ctx.accounts.covenant;
    covenant.executor = ctx.accounts.executor.key();
    covenant.collateral_amount = collateral_amount;
    covenant.status = CovenantStatus::Accepted;

    msg!("Covenant accepted by {}, collateral={}", covenant.executor, collateral_amount);
    
    Ok(())
}
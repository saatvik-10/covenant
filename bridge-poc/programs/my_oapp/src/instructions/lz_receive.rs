use crate::*;
use anchor_lang::prelude::*;
use oapp::{
    endpoint::{
        cpi::accounts::Clear,
        instructions::ClearParams,
        ConstructCPIContext, ID as ENDPOINT_ID,
    },
    LzReceiveParams,
};
use errors::CovenantBridgeError;

#[derive(Accounts)]
#[instruction(params: LzReceiveParams)]
pub struct LzReceive<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// OApp Store PDA.  This account represents the "address" of your OApp on
    /// Solana and can contain any state relevant to your application.
    /// Customize the fields in `Store` as needed.
    #[account(mut, seeds = [STORE_SEED], bump = store.bump)]
    pub store: Account<'info, Store>,
    /// Peer config PDA for the sending chain. Ensures `params.sender` can only be the allowed peer from that remote chain.
    #[account(
        seeds = [PEER_SEED, &store.key().to_bytes(), &params.src_eid.to_be_bytes()],
        bump = peer.bump,
        constraint = params.sender == peer.peer_address
    )]
    pub peer: Account<'info, PeerConfig>,

    #[account(mut)]
    pub covenant: Account<'info, covenant::Covenant>,

    pub covenant_program: Program<'info, covenant::program::Covenant>,
}

impl LzReceive<'_> {
    pub fn apply(ctx: &mut Context<LzReceive>, params: &LzReceiveParams) -> Result<()> {
        // The OApp Store PDA is used to sign the CPI to the Endpoint program.
        let seeds: &[&[u8]] = &[STORE_SEED, &[ctx.accounts.store.bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        // The first Clear::MIN_ACCOUNTS_LEN accounts were returned by
        // `lz_receive_types` and are required for Endpoint::clear
        let accounts_for_clear = &ctx.remaining_accounts[0..Clear::MIN_ACCOUNTS_LEN];
        // Call the Endpoint::clear CPI to clear the message from the Endpoint program.
        // This is necessary to ensure the message is processed only once and to
        // prevent replays.
        let _ = oapp::endpoint_cpi::clear(
            ENDPOINT_ID,
            ctx.accounts.store.key(),
            accounts_for_clear,
            seeds,
            ClearParams {
                receiver: ctx.accounts.store.key(),
                src_eid: params.src_eid,
                sender: params.sender,
                nonce: params.nonce,
                guid: params.guid,
                message: params.message.clone(),
            },
        )?;

        // From here on, you can process the message as needed by your use case.
        require!(params.message.len() == COVENANT_MESSAGE_LEN, CovenantBridgeError::InvalidMessageLength);

        let user_pubkey = Pubkey::try_from(&params.message[0..32]).unwrap();
        let mut constraint_hash = [0u8; 32];
        constraint_hash.copy_from_slice(&params.message[32..64]);
        let passed = params.message[64] != 0;

        // Manually verify the covenant account matches the derived PDA —
        // can't use a `seeds = [...]` constraint since these values only
        // exist after decoding the message.
        let (expected_covenant, _bump) = Pubkey::find_program_address(
            &[b"covenant", user_pubkey.as_ref(), constraint_hash.as_ref()],
            &covenant::ID,
        );
        require_keys_eq!(
            ctx.accounts.covenant.key(),
            expected_covenant,
            CovenantBridgeError::WrongCovenant
        );

        // CPI into covenant::receive_verdict, signed by this Store PDA
        let cpi_accounts = covenant::cpi::accounts::ReceiveVerdict {
            oapp_authority: ctx.accounts.store.to_account_info(),
            covenant: ctx.accounts.covenant.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.covenant_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        covenant::cpi::receive_verdict(cpi_ctx, user_pubkey, constraint_hash, passed)?;

        // You can add logic here to handle compose if the message contains a compose message

        Ok(())
    }
}


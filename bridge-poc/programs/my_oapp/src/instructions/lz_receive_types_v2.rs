use crate::*;

use anchor_lang::solana_program;
use errors::CovenantBridgeError;
use oapp::{
    common::{
        compact_accounts_with_alts, AccountMetaRef, AddressLocator, EXECUTION_CONTEXT_VERSION_1,
    },
    endpoint::ID as ENDPOINT_ID,
    lz_receive_types_v2::{
        get_accounts_for_clear,
        Instruction, LzReceiveTypesV2Result,
    },
    LzReceiveParams,
};


#[derive(Accounts)]
#[instruction(params: LzReceiveParams)]
pub struct LzReceiveTypesV2<'info> {
    #[account(seeds = [STORE_SEED], bump = store.bump)]
    pub store: Account<'info, Store>,
    // Note: include more accounts here if you had done so in the previous steps
}

impl LzReceiveTypesV2<'_> {
    /// Returns the execution plan for lz_receive with a minimal account set.
    pub fn apply(
        ctx: &Context<LzReceiveTypesV2>,
        params: &LzReceiveParams,
    ) -> Result<LzReceiveTypesV2Result> {
        // 1. Store PDA (writable) – matches LzReceive's `store` account
        let store_key = ctx.accounts.store.key();

        // 2. Derive peer PDA using store key + src_eid to match LzReceive
        let peer_seeds = [PEER_SEED, store_key.as_ref(), &params.src_eid.to_be_bytes()];
        let (peer, _) = Pubkey::find_program_address(&peer_seeds, ctx.program_id);

        let mut accounts = vec![
            // payer
            AccountMetaRef { pubkey: AddressLocator::Payer, is_writable: true },
            // store (writable)
            AccountMetaRef { pubkey: store_key.into(), is_writable: true },
            // peer
            AccountMetaRef { pubkey: peer.into(), is_writable: false }
        ];

        // covenant (writable) + covenant_program, derived from the same message
        // preimage the LzReceive handler parses, so the two derivations agree.
        require!(
            params.message.len() == COVENANT_MESSAGE_LEN,
            CovenantBridgeError::InvalidMessageLength
        );
        let covenant_user = Pubkey::new_from_array(<[u8; 32]>::try_from(&params.message[0..32]).unwrap());
        let covenant_hash: [u8; 32] = params.message[32..64].try_into().unwrap();
        let (covenant, _) = Pubkey::find_program_address(
            &[b"covenant", covenant_user.as_ref(), covenant_hash.as_ref()],
            &covenant::ID,
        );
        accounts.push(AccountMetaRef { pubkey: covenant.into(), is_writable: true });
        accounts.push(AccountMetaRef { pubkey: covenant::ID.into(), is_writable: false });

        // Add accounts required for LayerZero's clear operation
        // These accounts handle the core message verification and processing
        let accounts_for_clear: Vec<AccountMetaRef> = get_accounts_for_clear(
            ENDPOINT_ID,
            &store_key,
            params.src_eid,
            &params.sender,
            params.nonce,
        );
        accounts.extend(accounts_for_clear);

        // You can add handling of compose message here. Use accounts.extend() to add accounts needed for the send compose operation.

        // Return the execution plan (no clear/compose helper accounts)
        Ok(LzReceiveTypesV2Result {
            context_version: EXECUTION_CONTEXT_VERSION_1,
            // In this example, ALTs are passed in via remaining_accounts
            // This decision allows for flexibility in terms of passing in any number of ALTs without needing to change the accounts struct
            // However, if you need stronger schema guarantees and require only a single ALT, you may opt to have it passed in explicitly via ctx.accounts.alt (or similar)
            alts: ctx.remaining_accounts.iter().map(|alt| alt.key()).collect(),
            instructions: vec![
                // You can add additional instructions before the LzReceive instruction
                Instruction::LzReceive {
                    accounts: compact_accounts_with_alts(&ctx.remaining_accounts, accounts)?,
                },
                // You can add additional instructions after the LzReceive instruction
            ],
        })
    }
}
predicate;

mod personal_sign;

use std::constants::ZERO_B256;
use std::{
    b512::B512,
    bytes::Bytes,
    tx::{tx_id, tx_witness_data},
    vm::evm::ecr::ec_recover_evm_address,
};
use ::personal_sign::*;

configurable {
    OWNER_ADDRESS: b256 = ZERO_B256,
}

fn main() -> bool {
    
    let witness_index = 0;
    let compact_signature: B512 = tx_witness_data(witness_index).unwrap();
    
    // Recover the signer and compare
    match ec_recover_evm_address(compact_signature, personal_sign_hash(tx_id())) {
        Ok(recovered_address) => OWNER_ADDRESS == recovered_address.into(),
        Err(_) => false,
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract GasProbe {
    uint256 public ultimo;
    function medirModExp(bytes memory base, bytes memory exponent, bytes memory modulus)
        public returns (uint256 usado) {
        bytes memory input = abi.encodePacked(
            uint256(base.length), uint256(exponent.length), uint256(modulus.length),
            base, exponent, modulus);
        uint256 g0 = gasleft();
        (bool okc, ) = address(0x05).staticcall(input);
        usado = g0 - gasleft();
        require(okc, "modexp fallo");
        ultimo = usado;
    }
    function medirSstore(bytes32 k) public returns (uint256 usado) {
        uint256 g0 = gasleft();
        assembly { sstore(k, 1) }
        usado = g0 - gasleft();
        ultimo = usado;
    }
}

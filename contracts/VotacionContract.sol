// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Vot.Ar Blockchain
/// @notice Urna on-chain que registra votos anonimos mediante tokens firmados con RSA.
/// @dev El token firmado llega como abi.encode(bytes token, bytes signature).
/// La clave publica se persiste como abi.encode(bytes modulus, bytes exponent)
/// para verificar RSA con el precompile modexp (0x05) sin exponer identidad.
contract VotacionContract is Ownable, ReentrancyGuard {
    uint256 private constant RSA_MODULUS_LENGTH_BYTES = 256;
    uint256 private constant VOTE_TOKEN_LENGTH_BYTES = 32;
    bytes private constant VOTE_CREDENTIAL_DOMAIN = "VOT.AR/VOTE-CREDENTIAL/v1";
    enum EstadoUrna {
        CERRADA,
        ABIERTA,
        FINALIZADA
    }

    address public autoridad;
    EstadoUrna public estado;
    uint256 public fechaApertura;
    uint256 public fechaCierre;
    uint256 public totalVotosEmitidos;

    struct Candidato {
        uint8 id;
        string nombre;
        uint256 votos;
    }

    Candidato[] public candidatos;

    mapping(bytes32 => bool) public tokenUsado;

    /// @dev abi.encode(bytes modulus, bytes exponent)
    bytes public clavePublicaAutoridad;

    uint256 private constant RSA_PUBLIC_EXPONENT = 65537;

    event VotoEmitido(bytes32 indexed tokenHash, uint8 candidatoId);
    event UrnaAbierta(uint256 timestamp);
    event UrnaCerrada(uint256 timestamp);

    constructor(string[] memory nombresCandidatos, bytes memory pubKey) Ownable(msg.sender) {
        require(nombresCandidatos.length > 0, "Debe existir al menos un candidato");
        require(nombresCandidatos.length <= 256, "Maximo 256 candidatos");

        (bytes memory modulus, bytes memory exponent) = abi.decode(pubKey, (bytes, bytes));
        require(
            modulus.length == RSA_MODULUS_LENGTH_BYTES && exponent.length > 0,
            "Clave publica invalida"
        );
        // Validar solo la longitud del modulo dejaria pasar exponentes arbitrarios.
        // Un exponente igual a 1 volveria trivial la falsificacion, porque
        // s^1 mod n == s permitiria elegir la firma y derivar de ella el mensaje.
        // El exponente queda fijado en 65537, el valor canonico del esquema.
        require(_esExponenteCanonico(exponent), "Exponente publico invalido");

        autoridad = msg.sender;
        estado = EstadoUrna.CERRADA;
        clavePublicaAutoridad = pubKey;

        for (uint256 i = 0; i < nombresCandidatos.length; ++i) {
            candidatos.push(Candidato({id: uint8(i), nombre: nombresCandidatos[i], votos: 0}));
        }
    }

    modifier onlyAutoridad() {
        require(msg.sender == autoridad, "Solo la autoridad electoral");
        _;
    }

    modifier urnaAbierta() {
        require(estado == EstadoUrna.ABIERTA, "La urna no esta abierta");
        _;
    }

    function abrirUrna() external onlyAutoridad {
        require(estado == EstadoUrna.CERRADA, "La urna no puede abrirse");

        fechaApertura = block.timestamp;
        fechaCierre = 0;
        estado = EstadoUrna.ABIERTA;

        emit UrnaAbierta(block.timestamp);
    }

    function cerrarUrna() external onlyAutoridad {
        require(estado == EstadoUrna.ABIERTA, "La urna no esta abierta");

        fechaCierre = block.timestamp;
        estado = EstadoUrna.FINALIZADA;

        emit UrnaCerrada(block.timestamp);
    }

    function emitirVoto(bytes memory tokenFirmado, uint8 candidatoId) public urnaAbierta nonReentrant {
        require(candidatoId < candidatos.length, "Candidato invalido");

        (bytes memory token, ) = _decodeTokenFirmado(tokenFirmado);
        bytes32 tokenHash = keccak256(token);

        require(!tokenUsado[tokenHash], "El token ya fue utilizado");
        require(verificarToken(tokenFirmado), "Token o firma invalidos");

        tokenUsado[tokenHash] = true;
        candidatos[candidatoId].votos += 1;
        totalVotosEmitidos += 1;

        emit VotoEmitido(tokenHash, candidatoId);
    }

    function obtenerResultados() public view returns (Candidato[] memory resultados) {
        resultados = new Candidato[](candidatos.length);

        for (uint256 i = 0; i < candidatos.length; ++i) {
            Candidato storage candidato = candidatos[i];
            resultados[i] = Candidato({
                id: candidato.id,
                nombre: candidato.nombre,
                votos: candidato.votos
            });
        }
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        require(newOwner != address(0), "Owner invalido");
        autoridad = newOwner;
        super.transferOwnership(newOwner);
    }

    function renounceOwnership() public pure override {
        revert("Operacion deshabilitada");
    }

    function verificarToken(bytes memory tokenFirmado) internal view returns (bool) {
        (bytes memory token, bytes memory signature) = _decodeTokenFirmado(tokenFirmado);
        (bytes memory modulus, bytes memory exponent) = _decodePublicKey();

        if (token.length != VOTE_TOKEN_LENGTH_BYTES || signature.length != RSA_MODULUS_LENGTH_BYTES) {
            return false;
        }

        if (modulus.length != RSA_MODULUS_LENGTH_BYTES || exponent.length == 0) {
            return false;
        }

        bytes memory recoveredMessage = _modExp(signature, exponent, modulus);
        // RSA nunca firma el token crudo. La codificacion separada por dominio
        // impide que la propiedad multiplicativa de RSA genere otra credencial
        // valida a partir de firmas observadas.
        bytes memory normalizedToken = _leftPad(
            abi.encodePacked(sha256(abi.encodePacked(VOTE_CREDENTIAL_DOMAIN, token))),
            modulus.length
        );

        return keccak256(recoveredMessage) == keccak256(normalizedToken);
    }

    function _decodeTokenFirmado(bytes memory tokenFirmado)
        internal
        pure
        returns (bytes memory token, bytes memory signature)
    {
        (token, signature) = abi.decode(tokenFirmado, (bytes, bytes));
    }

    function _decodePublicKey() internal view returns (bytes memory modulus, bytes memory exponent) {
        (modulus, exponent) = abi.decode(clavePublicaAutoridad, (bytes, bytes));
    }

    function _modExp(bytes memory base, bytes memory exponent, bytes memory modulus)
        internal
        view
        returns (bytes memory output)
    {
        bytes memory input = abi.encodePacked(
            uint256(base.length),
            uint256(exponent.length),
            uint256(modulus.length),
            base,
            exponent,
            modulus
        );

        (bool success, bytes memory result) = address(0x05).staticcall(input);
        require(success && result.length == modulus.length, "Fallo verificacion RSA");

        return result;
    }

    /// Acepta 65537 en su codificacion canonica (0x010001) y con ceros a la izquierda.
    function _esExponenteCanonico(bytes memory exponent) internal pure returns (bool) {
        uint256 valor = 0;
        for (uint256 i = 0; i < exponent.length; ++i) {
            if (valor > type(uint256).max >> 8) {
                return false;
            }
            valor = (valor << 8) | uint8(exponent[i]);
        }
        return valor == RSA_PUBLIC_EXPONENT;
    }

    function _leftPad(bytes memory data, uint256 size) internal pure returns (bytes memory padded) {
        if (data.length > size) {
            return new bytes(0);
        }

        padded = new bytes(size);
        uint256 offset = size - data.length;

        for (uint256 i = 0; i < data.length; ++i) {
            padded[offset + i] = data[i];
        }
    }
}

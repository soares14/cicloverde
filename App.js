import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import * as Device from 'expo-device';
import { supabase } from './supabase';
 
// ---------------------------------------------------------------
// Paleta: verde-folha + âmbar de pão assado (desconto)
// ---------------------------------------------------------------
const COR = {
  fundo: '#F1F5EF',
  tinta: '#17261D',
  folha: '#2E7D4F',
  folhaClara: '#DCEFE2',
  ambar: '#E8A33D',
  apagado: '#66756B',
  borda: '#D5DFD7',
  erro: '#B3261E',
  erroClaro: '#F9E3E1',
  branco: '#FFFFFF',
};
 
const CATEGORIAS = ['Padaria', 'Hortifrúti', 'Refeições', 'Vegano'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAPEL = { consumidor: 'Cliente', lojista: 'Vendedor', admin: 'Administrador' };
 
const moeda = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR');
const numero = (v) => Number(String(v).replace(',', '.'));
 
// ---------------------------------------------------------------
// CPF e CNPJ: máscara e validação (o servidor valida de novo)
// ---------------------------------------------------------------
function mascaraCPF(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
 
function mascaraCNPJ(v) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}
 
function cpfValido(valor) {
  const d = valor.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
 
function cnpjValido(valor) {
  const d = valor.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * pesos[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}
 
// ---------------------------------------------------------------
// Raiz
// ---------------------------------------------------------------
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Raiz />
    </SafeAreaProvider>
  );
}
 
function Raiz() {
  const [carregando, setCarregando] = useState(true);
  const [comprometido, setComprometido] = useState(false);
  const [sessao, setSessao] = useState(null);
  const [perfil, setPerfil] = useState(null);
 
  useEffect(() => {
    (async () => {
      // OWASP Mobile: bloqueia aparelhos com root/jailbreak
      try {
        setComprometido(await Device.isRootedExperimentalAsync());
      } catch {}
      const { data } = await supabase.auth.getSession();
      setSessao(data.session);
      setCarregando(false);
    })();
 
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, nova) => setSessao(nova));
    return () => sub.subscription.unsubscribe();
  }, []);
 
  useEffect(() => {
    if (!sessao) {
      setPerfil(null);
      return;
    }
    supabase
      .from('perfis')
      .select('nome, papel')
      .eq('id', sessao.user.id)
      .single()
      .then(({ data }) => setPerfil(data ?? { nome: '', papel: 'consumidor' }));
  }, [sessao?.user?.id]);
 
  if (carregando || (sessao && !perfil)) {
    return (
      <SafeAreaView style={e.tela}>
        <View style={e.centro}><ActivityIndicator size="large" color={COR.folha} /></View>
      </SafeAreaView>
    );
  }
  if (comprometido) return <TelaBloqueio />;
  if (!sessao) return <TelaLogin />;
  return <AreaLogada sessao={sessao} perfil={perfil} />;
}
 
function TelaBloqueio() {
  return (
    <SafeAreaView style={e.tela}>
      <View style={e.centro}>
        <Text style={e.marca}>CicloVerde</Text>
        <Text style={[e.titulo, { marginTop: 24, textAlign: 'center' }]}>
          Este aparelho foi modificado
        </Text>
        <Text style={[e.texto, { textAlign: 'center', marginTop: 8 }]}>
          Detectamos root ou jailbreak. Para proteger seus dados e pagamentos, o app não funciona
          em aparelhos modificados.
        </Text>
      </View>
    </SafeAreaView>
  );
}
 
// ---------------------------------------------------------------
// Login e cadastro (cliente com CPF / vendedor com CNPJ)
// ---------------------------------------------------------------
function TelaLogin() {
  const [cadastro, setCadastro] = useState(false);
  const [tipo, setTipo] = useState('consumidor');
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [nomeLoja, setNomeLoja] = useState('');
  const [endereco, setEndereco] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const vendedor = tipo === 'lojista';
 
  function trocarTipo(novo) {
    setTipo(novo);
    setDocumento('');
  }
 
  async function entrar() {
    const emailLimpo = email.trim().toLowerCase();
    if (!emailLimpo || !senha) return Alert.alert('Preencha e-mail e senha');
    setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: emailLimpo, password: senha });
    setEnviando(false);
    // Mensagem genérica: não revela se o e-mail existe
    if (error) Alert.alert('Não foi possível entrar', 'E-mail ou senha incorretos.');
  }
 
  async function criarConta() {
    const emailLimpo = email.trim().toLowerCase();
    if (!nome.trim()) return Alert.alert('Informe seu nome');
    if (vendedor) {
      if (!nomeLoja.trim()) return Alert.alert('Informe o nome da loja');
      if (!cnpjValido(documento)) return Alert.alert('CNPJ inválido', 'Confira os 14 números.');
    } else if (!cpfValido(documento)) {
      return Alert.alert('CPF inválido', 'Confira os 11 números.');
    }
    if (!emailLimpo) return Alert.alert('Informe seu e-mail');
    if (senha.length < 8) return Alert.alert('Senha muito curta', 'Use pelo menos 8 caracteres.');
 
    setEnviando(true);
    const { error } = await supabase.auth.signUp({
      email: emailLimpo,
      password: senha,
      options: {
        data: {
          tipo,
          nome: nome.trim(),
          documento: documento.replace(/\D/g, ''),
          nome_loja: vendedor ? nomeLoja.trim() : null,
          endereco: vendedor ? endereco.trim() : null,
        },
      },
    });
    setEnviando(false);
 
    if (error) {
      const recusadoPeloBanco = /database error/i.test(error.message);
      Alert.alert(
        'Não foi possível criar a conta',
        recusadoPeloBanco ? `${vendedor ? 'CNPJ' : 'CPF'} inválido ou já cadastrado.` : error.message
      );
    }
  }
 
  return (
    <SafeAreaView style={e.tela}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={e.login} keyboardShouldPersistTaps="handled">
          <Text style={e.marca}>CicloVerde</Text>
          <Text style={[e.texto, { marginBottom: 28 }]}>
            Comida boa do fim do expediente, com até 70% de desconto.
          </Text>
 
          {cadastro && (
            <>
              <View style={e.seletor}>
                {[
                  { id: 'consumidor', rotulo: 'Sou cliente' },
                  { id: 'lojista', rotulo: 'Sou vendedor' },
                ].map((op) => (
                  <Pressable
                    key={op.id}
                    onPress={() => trocarTipo(op.id)}
                    style={[e.seletorOpcao, tipo === op.id && e.seletorAtivo]}
                  >
                    <Text style={[e.seletorTexto, tipo === op.id && { color: COR.branco }]}>{op.rotulo}</Text>
                  </Pressable>
                ))}
              </View>
 
              <TextInput
                style={e.campo}
                placeholder={vendedor ? 'Seu nome (responsável)' : 'Seu nome'}
                value={nome}
                onChangeText={setNome}
              />
 
              {vendedor ? (
                <>
                  <TextInput style={e.campo} placeholder="Nome da loja" value={nomeLoja} onChangeText={setNomeLoja} />
                  <TextInput
                    style={e.campo}
                    placeholder="CNPJ"
                    keyboardType="number-pad"
                    value={documento}
                    onChangeText={(v) => setDocumento(mascaraCNPJ(v))}
                  />
                  <TextInput
                    style={e.campo}
                    placeholder="Endereço da loja"
                    value={endereco}
                    onChangeText={setEndereco}
                  />
                </>
              ) : (
                <TextInput
                  style={e.campo}
                  placeholder="CPF"
                  keyboardType="number-pad"
                  value={documento}
                  onChangeText={(v) => setDocumento(mascaraCPF(v))}
                />
              )}
            </>
          )}
 
          <TextInput
            style={e.campo}
            placeholder="E-mail"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput style={e.campo} placeholder="Senha" secureTextEntry value={senha} onChangeText={setSenha} />
 
          <Botao
            titulo={cadastro ? 'Criar conta' : 'Entrar'}
            onPress={cadastro ? criarConta : entrar}
            carregando={enviando}
          />
          <Pressable onPress={() => setCadastro(!cadastro)} style={{ marginTop: 20 }}>
            <Text style={e.link}>{cadastro ? 'Já tenho conta. Entrar' : 'Não tem conta? Criar agora'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
 
// ---------------------------------------------------------------
// Área logada: abas mudam conforme o papel (RBAC também na interface)
// ---------------------------------------------------------------
function abasDoPapel(papel) {
  if (papel === 'lojista') {
    return [
      { id: 'loja', rotulo: 'Minha loja' },
      { id: 'validar', rotulo: 'Validar' },
    ];
  }
  if (papel === 'admin') {
    return [
      { id: 'sacolas', rotulo: 'Sacolas' },
      { id: 'reservas', rotulo: 'Reservas' },
      { id: 'validar', rotulo: 'Validar' },
      { id: 'logs', rotulo: 'Auditoria' },
    ];
  }
  return [
    { id: 'sacolas', rotulo: 'Sacolas' },
    { id: 'reservas', rotulo: 'Reservas' },
  ];
}
 
function AreaLogada({ sessao, perfil }) {
  const abas = abasDoPapel(perfil.papel);
  const [aba, setAba] = useState(abas[0].id);
  const usuarioId = sessao.user.id;
 
  return (
    <SafeAreaView style={e.tela} edges={['top', 'bottom']}>
      <View style={e.cabecalho}>
        <View>
          <Text style={e.marca}>CicloVerde</Text>
          <Text style={e.miudo}>{perfil.nome || sessao.user.email}</Text>
          <Text style={e.miudo}>{PAPEL[perfil.papel] ?? perfil.papel}</Text>
        </View>
        <Pressable onPress={() => supabase.auth.signOut()} hitSlop={12}>
          <Text style={e.link}>Sair</Text>
        </Pressable>
      </View>
 
      <View style={{ flex: 1 }}>
        {aba === 'sacolas' && <TelaSacolas />}
        {aba === 'reservas' && <TelaReservas usuarioId={usuarioId} />}
        {aba === 'loja' && <TelaMinhaLoja usuarioId={usuarioId} />}
        {aba === 'validar' && <TelaValidar />}
        {aba === 'logs' && <TelaAuditoria />}
      </View>
 
      <View style={e.abas}>
        {abas.map((a) => (
          <Pressable key={a.id} onPress={() => setAba(a.id)} style={e.aba}>
            <View style={[e.abaMarca, aba === a.id && { backgroundColor: COR.folha }]} />
            <Text style={[e.abaTexto, aba === a.id && { color: COR.folha, fontWeight: '700' }]}>{a.rotulo}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
 
// ---------------------------------------------------------------
// Cliente: lista de sacolas
// ---------------------------------------------------------------
function TelaSacolas() {
  const [sacolas, setSacolas] = useState([]);
  const [categoria, setCategoria] = useState('Todas');
  const [carregando, setCarregando] = useState(false);
  const [reservando, setReservando] = useState(null);
 
  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from('sacolas')
      .select('id, titulo, categoria, preco_original, preco, quantidade, lojas(nome, endereco)')
      .order('criado_em', { ascending: false });
    setCarregando(false);
    if (error) return Alert.alert('Não foi possível carregar as sacolas', error.message);
    setSacolas(data);
  }, []);
 
  useEffect(() => {
    carregar();
  }, [carregar]);
 
  async function reservar(sacola) {
    setReservando(sacola.id);
    const { error } = await supabase.rpc('reservar_sacola', { p_sacola: sacola.id });
    setReservando(null);
    if (error) return Alert.alert('Não foi possível reservar', error.message);
    Alert.alert('Sacola reservada', 'Abra a aba Reservas para gerar o QR Code de retirada.');
    carregar();
  }
 
  const lista = categoria === 'Todas' ? sacolas : sacolas.filter((s) => s.categoria === categoria);
 
  return (
    <View style={{ flex: 1 }}>
      <Chips opcoes={['Todas', ...CATEGORIAS]} valor={categoria} aoMudar={setCategoria} />
      <FlatList
        data={lista}
        keyExtractor={(i) => i.id}
        contentContainerStyle={e.lista}
        refreshControl={<RefreshControl refreshing={carregando} onRefresh={carregar} />}
        ListEmptyComponent={
          !carregando && <Text style={e.vazio}>Nenhuma sacola nesta categoria agora. Puxe para atualizar.</Text>
        }
        renderItem={({ item }) => {
          const esgotada = item.quantidade <= 0;
          return (
            <CartaoSacola sacola={item} mostrarLoja>
              <Botao
                titulo="Reservar sacola"
                onPress={() => reservar(item)}
                desativado={esgotada}
                carregando={reservando === item.id}
              />
            </CartaoSacola>
          );
        }}
      />
    </View>
  );
}
 
// ---------------------------------------------------------------
// Cliente: reservas (QR Code ou cancelar)
// ---------------------------------------------------------------
function TelaReservas({ usuarioId }) {
  const [reservas, setReservas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [aberta, setAberta] = useState(null);
 
  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from('reservas')
      .select('id, status, criado_em, retirada_em, sacolas(titulo, preco, lojas(nome, endereco))')
      .eq('usuario_id', usuarioId)
      .order('criado_em', { ascending: false });
    setCarregando(false);
    if (error) return Alert.alert('Não foi possível carregar as reservas', error.message);
    setReservas(data);
  }, [usuarioId]);
 
  useEffect(() => {
    carregar();
  }, [carregar]);
 
  function cancelar(reserva) {
    Alert.alert('Cancelar reserva?', 'A sacola volta a ficar disponível para outras pessoas.', [
      { text: 'Manter reserva', style: 'cancel' },
      {
        text: 'Cancelar reserva',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('cancelar_reserva', { p_reserva: reserva.id });
          if (error) Alert.alert('Não foi possível cancelar', error.message);
          carregar();
        },
      },
    ]);
  }
 
  const rotuloStatus = { pendente: 'Aguardando retirada', retirada: 'Retirada', cancelada: 'Cancelada' };
 
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={reservas}
        keyExtractor={(i) => i.id}
        contentContainerStyle={e.lista}
        refreshControl={<RefreshControl refreshing={carregando} onRefresh={carregar} />}
        ListEmptyComponent={
          !carregando && <Text style={e.vazio}>Você ainda não reservou nenhuma sacola.</Text>
        }
        renderItem={({ item }) => {
          const pendente = item.status === 'pendente';
          return (
            <View style={[e.card, item.status === 'cancelada' && { opacity: 0.55 }]}>
              <View style={e.linha}>
                <Text
                  style={[
                    e.status,
                    pendente ? e.statusPendente : item.status === 'retirada' ? e.statusFeito : e.statusCancelado,
                  ]}
                >
                  {rotuloStatus[item.status]}
                </Text>
                <Text style={e.miudo}>{dataHora(item.criado_em)}</Text>
              </View>
              <Text style={e.titulo}>{item.sacolas?.titulo}</Text>
              <Text style={e.texto}>{item.sacolas?.lojas?.nome}</Text>
              <Text style={e.miudo}>{item.sacolas?.lojas?.endereco}</Text>
              <Text style={[e.texto, { fontWeight: '700', marginTop: 4 }]}>{moeda(item.sacolas?.preco)}</Text>
              {pendente && (
                <>
                  <Botao titulo="Mostrar QR Code" onPress={() => setAberta(item)} />
                  <Botao titulo="Cancelar reserva" variante="perigo" onPress={() => cancelar(item)} />
                </>
              )}
            </View>
          );
        }}
      />
      <ModalQR
        reserva={aberta}
        aoFechar={() => {
          setAberta(null);
          carregar();
        }}
      />
    </View>
  );
}
 
function ModalQR({ reserva, aoFechar }) {
  const [token, setToken] = useState(null);
  const [segundos, setSegundos] = useState(0);
  const [gerando, setGerando] = useState(false);
 
  async function gerar() {
    setGerando(true);
    const { data, error } = await supabase.rpc('gerar_qr', { p_reserva: reserva.id });
    setGerando(false);
    if (error) {
      Alert.alert('Não foi possível gerar o QR Code', error.message);
      return aoFechar();
    }
    setToken(data.token);
    setSegundos(60);
  }
 
  useEffect(() => {
    if (reserva) gerar();
    else {
      setToken(null);
      setSegundos(0);
    }
  }, [reserva?.id]);
 
  useEffect(() => {
    if (segundos <= 0) return;
    const t = setTimeout(() => setSegundos((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [segundos]);
 
  const expirado = token && !gerando && segundos <= 0;
 
  return (
    <Modal visible={!!reserva} animationType="slide" transparent onRequestClose={aoFechar}>
      <View style={e.modalFundo}>
        <View style={[e.modalCaixa, { alignItems: 'center' }]}>
          <Text style={e.titulo}>{reserva?.sacolas?.titulo}</Text>
          <Text style={e.texto}>Mostre este código no balcão da loja.</Text>
 
          <View style={[e.qrMoldura, expirado && { borderColor: COR.erro }]}>
            {gerando || !token ? <ActivityIndicator size="large" color={COR.folha} /> : <QRCode value={token} size={210} />}
          </View>
 
          {token && !gerando && (
            <Text style={[e.contador, expirado && { color: COR.erro }]}>
              {expirado ? 'Código expirado' : `Válido por ${segundos}s`}
            </Text>
          )}
          <View style={e.barra}>
            <View style={[e.barraCheia, { width: `${(segundos / 60) * 100}%` }]} />
          </View>
 
          {expirado && <Botao titulo="Gerar novo código" onPress={gerar} />}
          <Botao titulo="Fechar" variante="secundario" onPress={aoFechar} />
        </View>
      </View>
    </Modal>
  );
}
 
// ---------------------------------------------------------------
// Vendedor: minha loja (publicar e gerenciar sacolas)
// ---------------------------------------------------------------
function TelaMinhaLoja({ usuarioId }) {
  const [loja, setLoja] = useState(undefined); // undefined = carregando, null = sem loja
  const [sacolas, setSacolas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [formAberto, setFormAberto] = useState(false);
 
  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data: minhaLoja, error } = await supabase
      .from('lojas')
      .select('id, nome, cnpj, endereco')
      .eq('dono_id', usuarioId)
      .maybeSingle();
    if (error) {
      setCarregando(false);
      return Alert.alert('Não foi possível carregar sua loja', error.message);
    }
    setLoja(minhaLoja);
    if (minhaLoja) {
      const { data } = await supabase
        .from('sacolas')
        .select('id, titulo, categoria, preco_original, preco, quantidade')
        .eq('loja_id', minhaLoja.id)
        .order('criado_em', { ascending: false });
      setSacolas(data ?? []);
    }
    setCarregando(false);
  }, [usuarioId]);
 
  useEffect(() => {
    carregar();
  }, [carregar]);
 
  async function mudarEstoque(sacola, novaQuantidade) {
    const { error } = await supabase
      .from('sacolas')
      .update({ quantidade: Math.max(0, novaQuantidade) })
      .eq('id', sacola.id);
    if (error) Alert.alert('Não foi possível atualizar o estoque', error.message);
    carregar();
  }
 
  if (loja === undefined) {
    return <View style={e.centro}><ActivityIndicator color={COR.folha} /></View>;
  }
 
  if (loja === null) {
    return (
      <View style={e.centro}>
        <Text style={[e.texto, { textAlign: 'center' }]}>
          Esta conta de vendedor não tem loja cadastrada. Crie uma nova conta escolhendo "Sou vendedor".
        </Text>
      </View>
    );
  }
 
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={sacolas}
        keyExtractor={(i) => i.id}
        contentContainerStyle={e.lista}
        refreshControl={<RefreshControl refreshing={carregando} onRefresh={carregar} />}
        ListHeaderComponent={
          <View style={{ marginBottom: 16 }}>
            <View style={e.lojaInfo}>
              <Text style={e.titulo}>{loja.nome}</Text>
              {loja.cnpj && <Text style={e.miudo}>CNPJ {mascaraCNPJ(loja.cnpj)}</Text>}
              {loja.endereco && <Text style={e.miudo}>{loja.endereco}</Text>}
            </View>
            <Botao titulo="Publicar nova sacola" onPress={() => setFormAberto(true)} />
          </View>
        }
        ListEmptyComponent={
          !carregando && (
            <Text style={e.vazio}>
              Você ainda não publicou nenhuma sacola. Publique a primeira com o que sobrou hoje.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <CartaoSacola sacola={item}>
            <View style={e.estoqueControles}>
              <Pressable style={e.estoqueBotao} onPress={() => mudarEstoque(item, item.quantidade - 1)}>
                <Text style={e.estoqueBotaoTexto}>−</Text>
              </Pressable>
              <Text style={e.estoqueNumero}>{item.quantidade}</Text>
              <Pressable style={e.estoqueBotao} onPress={() => mudarEstoque(item, item.quantidade + 1)}>
                <Text style={e.estoqueBotaoTexto}>+</Text>
              </Pressable>
              <Pressable
                onPress={() => mudarEstoque(item, 0)}
                disabled={item.quantidade === 0}
                style={{ marginLeft: 'auto' }}
              >
                <Text style={[e.link, { color: item.quantidade === 0 ? COR.apagado : COR.erro }]}>
                  Encerrar oferta
                </Text>
              </Pressable>
            </View>
          </CartaoSacola>
        )}
      />
      <ModalNovaSacola
        visivel={formAberto}
        lojaId={loja.id}
        aoFechar={() => setFormAberto(false)}
        aoPublicar={() => {
          setFormAberto(false);
          carregar();
        }}
      />
    </View>
  );
}
 
function ModalNovaSacola({ visivel, lojaId, aoFechar, aoPublicar }) {
  const [titulo, setTitulo] = useState('');
  const [categoria, setCategoria] = useState('Padaria');
  const [precoOriginal, setPrecoOriginal] = useState('');
  const [preco, setPreco] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [salvando, setSalvando] = useState(false);
 
  function limpar() {
    setTitulo('');
    setCategoria('Padaria');
    setPrecoOriginal('');
    setPreco('');
    setQuantidade('');
  }
 
  async function publicar() {
    const original = numero(precoOriginal);
    const comDesconto = numero(preco);
    const qtd = parseInt(quantidade, 10);
 
    if (!titulo.trim()) return Alert.alert('Dê um nome para a sacola');
    if (!(original > 0) || !(comDesconto > 0)) return Alert.alert('Preencha os dois preços');
    if (comDesconto > original) return Alert.alert('O preço com desconto precisa ser menor que o original');
    if (!(qtd > 0)) return Alert.alert('Informe quantas sacolas estão disponíveis');
 
    setSalvando(true);
    const { error } = await supabase.from('sacolas').insert({
      loja_id: lojaId,
      titulo: titulo.trim(),
      categoria,
      preco_original: original,
      preco: comDesconto,
      quantidade: qtd,
    });
    setSalvando(false);
 
    if (error) return Alert.alert('Não foi possível publicar', error.message);
    limpar();
    aoPublicar();
  }
 
  return (
    <Modal visible={visivel} animationType="slide" transparent onRequestClose={aoFechar}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={e.modalFundo}>
          <ScrollView style={e.modalCaixa} keyboardShouldPersistTaps="handled">
            <Text style={[e.titulo, { marginBottom: 16 }]}>Nova sacola</Text>
 
            <TextInput
              style={e.campo}
              placeholder="Ex.: Sacola surpresa de pães"
              value={titulo}
              onChangeText={setTitulo}
            />
 
            <Text style={e.rotuloCampo}>Categoria</Text>
            <Chips opcoes={CATEGORIAS} valor={categoria} aoMudar={setCategoria} semMargem />
 
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={e.rotuloCampo}>Preço original</Text>
                <TextInput
                  style={e.campo}
                  placeholder="40,00"
                  keyboardType="decimal-pad"
                  value={precoOriginal}
                  onChangeText={setPrecoOriginal}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={e.rotuloCampo}>Com desconto</Text>
                <TextInput
                  style={e.campo}
                  placeholder="14,90"
                  keyboardType="decimal-pad"
                  value={preco}
                  onChangeText={setPreco}
                />
              </View>
            </View>
 
            <Text style={e.rotuloCampo}>Quantidade disponível</Text>
            <TextInput
              style={e.campo}
              placeholder="5"
              keyboardType="number-pad"
              value={quantidade}
              onChangeText={setQuantidade}
            />
 
            <Botao titulo="Publicar sacola" onPress={publicar} carregando={salvando} />
            <Botao titulo="Cancelar" variante="secundario" onPress={aoFechar} />
            <View style={{ height: 32 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
 
// ---------------------------------------------------------------
// Vendedor/admin: escanear e validar QR Code
// ---------------------------------------------------------------
function TelaValidar() {
  const [permissao, pedirPermissao] = useCameraPermissions();
  const [resultado, setResultado] = useState(null);
  const [validando, setValidando] = useState(false);
  const travado = useRef(false);
 
  async function aoLer({ data }) {
    if (travado.current) return;
    travado.current = true;
    setValidando(true);
 
    let res;
    if (!UUID.test(data)) {
      res = { ok: false, mensagem: 'Este QR Code não é da CicloVerde.' };
    } else {
      const { data: r, error } = await supabase.rpc('validar_qr', { p_token: data });
      res = error ? { ok: false, mensagem: error.message } : r;
    }
    setResultado(res);
    setValidando(false);
  }
 
  function escanearOutro() {
    setResultado(null);
    travado.current = false;
  }
 
  if (!permissao) {
    return <View style={e.centro}><ActivityIndicator color={COR.folha} /></View>;
  }
 
  if (!permissao.granted) {
    return (
      <View style={e.centro}>
        <Text style={[e.texto, { textAlign: 'center', marginBottom: 8 }]}>
          A câmera é usada para ler o QR Code do cliente no balcão.
        </Text>
        <Botao titulo="Permitir câmera" onPress={pedirPermissao} />
      </View>
    );
  }
 
  if (resultado) {
    return (
      <View style={e.centro}>
        <View style={[e.resultado, { backgroundColor: resultado.ok ? COR.folhaClara : COR.erroClaro }]}>
          <Text style={[e.resultadoIcone, { color: resultado.ok ? COR.folha : COR.erro }]}>
            {resultado.ok ? '✓' : '✕'}
          </Text>
          <Text style={[e.titulo, { textAlign: 'center' }]}>{resultado.mensagem}</Text>
        </View>
        <Botao titulo="Escanear outro código" onPress={escanearOutro} />
      </View>
    );
  }
 
  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={aoLer}
      />
      <View style={e.cameraAviso}>
        <Text style={e.cameraAvisoTexto}>{validando ? 'Validando...' : 'Aponte para o QR Code do cliente'}</Text>
      </View>
    </View>
  );
}
 
// ---------------------------------------------------------------
// Admin: trilha de auditoria (somente leitura)
// ---------------------------------------------------------------
function TelaAuditoria() {
  const [logs, setLogs] = useState([]);
  const [carregando, setCarregando] = useState(false);
 
  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from('logs_auditoria')
      .select('id, acao, detalhes, criado_em, usuario_id')
      .order('criado_em', { ascending: false })
      .limit(100);
    setCarregando(false);
    if (error) return Alert.alert('Não foi possível carregar os registros', error.message);
    setLogs(data);
  }, []);
 
  useEffect(() => {
    carregar();
  }, [carregar]);
 
  const alerta = (acao) => /invalido|expirado|negada/.test(acao);
 
  return (
    <FlatList
      data={logs}
      keyExtractor={(i) => String(i.id)}
      contentContainerStyle={e.lista}
      refreshControl={<RefreshControl refreshing={carregando} onRefresh={carregar} />}
      ListHeaderComponent={
        <Text style={[e.texto, { marginBottom: 12 }]}>
          Registros imutáveis: ninguém consegue alterar ou apagar estes eventos.
        </Text>
      }
      ListEmptyComponent={!carregando && <Text style={e.vazio}>Nenhum evento registrado ainda.</Text>}
      renderItem={({ item }) => (
        <View style={[e.log, alerta(item.acao) && { borderLeftColor: COR.erro }]}>
          <Text style={[e.logAcao, alerta(item.acao) && { color: COR.erro }]}>{item.acao}</Text>
          <Text style={e.miudo}>{dataHora(item.criado_em)}</Text>
          <Text style={e.miudo}>Usuário: {item.usuario_id ?? 'desconhecido'}</Text>
          <Text style={e.miudo}>{JSON.stringify(item.detalhes)}</Text>
        </View>
      )}
    />
  );
}
 
// ---------------------------------------------------------------
// Componentes reutilizáveis
// ---------------------------------------------------------------
function CartaoSacola({ sacola, mostrarLoja, children }) {
  const esgotada = sacola.quantidade <= 0;
  const desconto = Math.round((1 - sacola.preco / sacola.preco_original) * 100);
  return (
    <View style={[e.card, esgotada && { opacity: 0.6 }]}>
      <View style={e.linha}>
        <Text style={e.categoria}>{sacola.categoria}</Text>
        <Text style={e.estoque}>{esgotada ? 'Esgotada' : `${sacola.quantidade} disponíveis`}</Text>
      </View>
      <Text style={e.titulo}>{sacola.titulo}</Text>
      {mostrarLoja && (
        <>
          <Text style={e.texto}>{sacola.lojas?.nome}</Text>
          <Text style={e.miudo}>{sacola.lojas?.endereco}</Text>
        </>
      )}
      <View style={[e.linha, { marginTop: 16, alignItems: 'flex-end' }]}>
        <View>
          <Text style={e.precoAntigo}>{moeda(sacola.preco_original)}</Text>
          <Text style={e.preco}>{moeda(sacola.preco)}</Text>
        </View>
        <View style={e.selo}>
          <Text style={e.seloTexto}>-{desconto}%</Text>
        </View>
      </View>
      {children}
    </View>
  );
}
 
function Chips({ opcoes, valor, aoMudar, semMargem }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={[e.chips, semMargem && { paddingHorizontal: 0 }]}
    >
      {opcoes.map((c) => (
        <Pressable key={c} onPress={() => aoMudar(c)} style={[e.chip, valor === c && e.chipAtivo]}>
          <Text style={[e.chipTexto, valor === c && { color: COR.branco }]}>{c}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
 
function Botao({ titulo, onPress, desativado, carregando, variante = 'primario' }) {
  const sec = variante === 'secundario';
  const perigo = variante === 'perigo';
  const corTexto = sec ? COR.folha : perigo ? COR.erro : COR.branco;
  return (
    <Pressable
      onPress={onPress}
      disabled={desativado || carregando}
      style={({ pressed }) => [
        e.botao,
        sec && e.botaoSec,
        perigo && e.botaoPerigo,
        desativado && { backgroundColor: COR.borda },
        pressed && { opacity: 0.85 },
      ]}
    >
      {carregando ? (
        <ActivityIndicator color={corTexto} />
      ) : (
        <Text style={[e.botaoTexto, { color: corTexto }]}>{titulo}</Text>
      )}
    </Pressable>
  );
}
 
// ---------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------
const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: COR.fundo },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  login: { flexGrow: 1, justifyContent: 'center', padding: 28 },
 
  marca: { fontSize: 30, fontWeight: '800', color: COR.folha, letterSpacing: -0.8 },
  titulo: { fontSize: 19, fontWeight: '700', color: COR.tinta, marginTop: 6 },
  texto: { fontSize: 15, color: COR.tinta, lineHeight: 21 },
  miudo: { fontSize: 13, color: COR.apagado, marginTop: 2 },
  link: { fontSize: 15, color: COR.folha, fontWeight: '600', textAlign: 'center' },
  vazio: { textAlign: 'center', color: COR.apagado, marginTop: 48, paddingHorizontal: 24 },
 
  campo: {
    backgroundColor: COR.branco, borderWidth: 1, borderColor: COR.borda, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, marginBottom: 12, color: COR.tinta,
  },
  rotuloCampo: { fontSize: 13, fontWeight: '600', color: COR.apagado, marginBottom: 6 },
 
  seletor: {
    flexDirection: 'row', backgroundColor: COR.branco, borderRadius: 12, padding: 4,
    borderWidth: 1, borderColor: COR.borda, marginBottom: 16,
  },
  seletorOpcao: { flex: 1, paddingVertical: 12, borderRadius: 9, alignItems: 'center' },
  seletorAtivo: { backgroundColor: COR.folha },
  seletorTexto: { fontSize: 15, fontWeight: '700', color: COR.tinta },
 
  cabecalho: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
  },
 
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: COR.borda, backgroundColor: COR.branco,
  },
  chipAtivo: { backgroundColor: COR.tinta, borderColor: COR.tinta },
  chipTexto: { fontSize: 14, color: COR.tinta },
 
  lista: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    backgroundColor: COR.branco, borderRadius: 14, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: COR.borda,
  },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoria: { fontSize: 13, fontWeight: '700', color: COR.folha },
  estoque: { fontSize: 13, color: COR.apagado },
 
  precoAntigo: { fontSize: 14, color: COR.apagado, textDecorationLine: 'line-through' },
  preco: { fontSize: 30, fontWeight: '800', color: COR.tinta, letterSpacing: -1 },
  selo: { backgroundColor: COR.ambar, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  seloTexto: { fontSize: 18, fontWeight: '800', color: COR.tinta },
 
  status: { fontSize: 13, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, overflow: 'hidden' },
  statusPendente: { backgroundColor: '#FBEBC9', color: '#7A5210' },
  statusFeito: { backgroundColor: COR.folhaClara, color: COR.folha },
  statusCancelado: { backgroundColor: COR.borda, color: COR.apagado },
 
  lojaInfo: {
    backgroundColor: COR.folhaClara, borderRadius: 14, padding: 16,
  },
  estoqueControles: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 12 },
  estoqueBotao: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: COR.folha,
    alignItems: 'center', justifyContent: 'center',
  },
  estoqueBotaoTexto: { fontSize: 20, fontWeight: '700', color: COR.folha },
  estoqueNumero: { fontSize: 18, fontWeight: '700', color: COR.tinta, minWidth: 24, textAlign: 'center' },
 
  botao: {
    backgroundColor: COR.folha, borderRadius: 10, paddingVertical: 14,
    alignItems: 'center', marginTop: 16, alignSelf: 'stretch',
  },
  botaoSec: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: COR.folha, marginTop: 10 },
  botaoPerigo: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: COR.erro, marginTop: 10 },
  botaoTexto: { fontSize: 16, fontWeight: '700' },
 
  abas: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COR.borda, backgroundColor: COR.branco },
  aba: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  abaMarca: { width: 22, height: 3, borderRadius: 2, marginBottom: 6, backgroundColor: 'transparent' },
  abaTexto: { fontSize: 13, color: COR.apagado },
 
  modalFundo: { flex: 1, backgroundColor: 'rgba(23,38,29,0.55)', justifyContent: 'flex-end' },
  modalCaixa: {
    backgroundColor: COR.fundo, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 24, paddingBottom: 36, maxHeight: '90%', flexGrow: 0,
  },
  qrMoldura: {
    width: 250, height: 250, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COR.branco, borderRadius: 16, borderWidth: 3, borderColor: COR.folha, marginTop: 20,
  },
  contador: { fontSize: 17, fontWeight: '700', color: COR.folha, marginTop: 14 },
  barra: { width: 250, height: 6, backgroundColor: COR.borda, borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  barraCheia: { height: 6, backgroundColor: COR.folha },
 
  cameraAviso: {
    position: 'absolute', bottom: 24, left: 24, right: 24,
    backgroundColor: 'rgba(23,38,29,0.8)', borderRadius: 10, padding: 14,
  },
  cameraAvisoTexto: { color: COR.branco, textAlign: 'center', fontSize: 15 },
  resultado: { width: '100%', borderRadius: 16, padding: 28, alignItems: 'center' },
  resultadoIcone: { fontSize: 56, fontWeight: '800' },
 
  log: {
    backgroundColor: COR.branco, borderRadius: 10, padding: 14, marginBottom: 10,
    borderLeftWidth: 4, borderLeftColor: COR.folha,
  },
  logAcao: { fontSize: 15, fontWeight: '700', color: COR.tinta },
});
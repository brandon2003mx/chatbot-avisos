// Script para testear la creación de avisos directamente
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const {db} = require('./src/config/firebase');

async function testCreateNotice() {
  try {
    console.log('\n🧪 INICIANDO TEST DE CREACIÓN DE AVISO\n');
    
    // Datos de prueba
    const testNotice = {
      titulo: 'Aviso de Test - Directo desde Script',
      contenido: 'Este aviso fue creado directamente por el script test-notice.js',
      prioridad: 'Alta',
      carrera: 'Ingeniería en Sistemas',
      semestre: '1',
      grupo: 'A',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'test-script',
    };
    
    console.log('📝 Intentando guardar:', testNotice);
    
    // Intenta guardarlo
    const docRef = await db.collection('avisos').add(testNotice);
    console.log('✅ ÉXITO: Aviso creado con ID:', docRef.id);
    
    // Ahora intenta leerlo de inmediato
    const docSnapshot = await docRef.get();
    if (docSnapshot.exists) {
      console.log('✅ VERIFICACIÓN: Documento leído exitosamente:', docSnapshot.data());
    } else {
      console.log('❌ ERROR: Documento no encontrado después de crearlo');
    }
    
    // Intenta contar todos los avisos
    const allAvisos = await db.collection('avisos').get();
    console.log(`📊 Total de avisos en la colección: ${allAvisos.size}`);
    
    console.log('\n✅ TEST COMPLETADO\n');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ ERROR:', error);
    process.exit(1);
  }
}

// Ejecutar con delay para permitir que se conecte
setTimeout(testCreateNotice, 2000);

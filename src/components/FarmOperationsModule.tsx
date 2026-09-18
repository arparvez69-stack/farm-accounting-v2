import React, { useEffect, useMemo, useState } from 'react';
import {
  Tractor,
  Fish,
  Wheat,
  PlusCircle,
  Activity,
  ArrowRightLeft,
  Factory,
  CheckCircle2,
  AlertCircle,
  Calendar,
  DollarSign,
  Syringe,
  X,
  History,
  Tag,
  Scale,
  Droplets,
  Clock,
  FileText,
  Users,
  CheckSquare,
  AlertTriangle,
  Search,
  Camera,
  Upload,
  Image as ImageIcon,
  Edit3,
  Trash2
} from 'lucide-react';
import { db } from '../db/indexedDb';
import {
  Animal,
  AnimalEvent,
  AnimalStatus,
  CropCycle,
  FishBatch,
  InternalFlow,
  ProcessingRun,
  Reminder,
  UserRole
} from '../types';
import { generateTransactionNumber, generateUniqueId, safeInsert } from '../utils/idGenerator';
import {
  executeAnimalEventTransaction,
  executeAnimalSaleOrRemovalTransaction
} from '../services/transactionService';
import { AnimalDetailView } from './AnimalDetailView';
import { notifyUndoableAction } from '../services/undoService';

/**
 * Compresses an image file client-side to a max width of 800px preserving aspect ratio,
 * and exports as JPEG base64 string to keep IndexedDB and Firestore lightweight.
 */
function compressImageFile(file: File, maxWidth = 800, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('অনুগ্রহ করে একটি বৈধ ছবি ফাইল (JPEG, PNG, WebP) নির্বাচন করুন।'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ছবি পড়তে ত্রুটি হয়েছে।'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ছবি লোড করা যায়নি।'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('ক্যানভাস প্রক্রিয়া করা সম্ভব হয়নি।'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

interface Props {
  role: UserRole;
  currentUserId: string;
  initialAnimalId?: string | null;
  onClearInitialAnimalId?: () => void;
  initialAction?: {
    openActivityModal?: boolean;
    eventType?: AnimalEvent['eventType'];
  } | null;
  onClearInitialAction?: () => void;
}

type OpsTab = 'livestock' | 'fisheries' | 'crops' | 'flows' | 'processing';

export const FarmOperationsModule: React.FC<Props> = ({
  role,
  currentUserId,
  initialAnimalId,
  onClearInitialAnimalId,
  initialAction,
  onClearInitialAction
}) => {
  const [tab, setTab] = useState<OpsTab>('livestock');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [animals, setAnimals] = useState<Animal[]>([]);
  const [animalEvents, setAnimalEvents] = useState<AnimalEvent[]>([]);
  const [animalFilter, setAnimalFilter] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [selectedAnimalId, setSelectedAnimalId] = useState<string | null>(null);
  const selectedAnimal = animals.find((a) => a.id === selectedAnimalId) || null;
  const [fishBatches, setFishBatches] = useState<FishBatch[]>([]);
  const [cropCycles, setCropCycles] = useState<CropCycle[]>([]);
  const [internalFlows, setInternalFlows] = useState<InternalFlow[]>([]);
  const [processingRuns, setProcessingRuns] = useState<ProcessingRun[]>([]);

  // Standalone Reminder Form State
  const [showAddReminderModal, setShowAddReminderModal] = useState(false);
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderCategory, setReminderCategory] = useState<'VACCINE' | 'TREATMENT' | 'MARKET' | 'OTHER'>('MARKET');
  const [reminderDueDate, setReminderDueDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [reminderAnimalId, setReminderAnimalId] = useState<string>('');

  // Add Animal
  const [showAddAnimal, setShowAddAnimal] = useState(false);
  const [tagId, setTagId] = useState('');
  const [species, setSpecies] = useState<'CATTLE' | 'GOAT' | 'SHEEP'>('CATTLE');
  const [breed, setBreed] = useState('দেশি ও ফ্রিজিয়ান ক্রস');
  const [gender, setGender] = useState<'MALE' | 'FEMALE'>('FEMALE');
  const [purchaseCost, setPurchaseCost] = useState('65000');
  const [currentWeight, setCurrentWeight] = useState('180');
  const [animalBirthDate, setAnimalBirthDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [animalPurchaseDate, setAnimalPurchaseDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [animalPhotoUrl, setAnimalPhotoUrl] = useState<string>('');
  const [photoCompressing, setPhotoCompressing] = useState<boolean>(false);
  const [duplicateTagWarning, setDuplicateTagWarning] = useState<{
    tag: string;
    animalData: Animal;
  } | null>(null);
  const [animalSearch, setAnimalSearch] = useState<string>('');

  // Edit Animal Modal state
  const [editingAnimal, setEditingAnimal] = useState<Animal | null>(null);
  const [editTag, setEditTag] = useState('');
  const [editSpecies, setEditSpecies] = useState<'CATTLE' | 'GOAT' | 'SHEEP'>('CATTLE');
  const [editBreed, setEditBreed] = useState('');
  const [editGender, setEditGender] = useState<'MALE' | 'FEMALE'>('FEMALE');
  const [editBirthDate, setEditBirthDate] = useState('');
  const [editPurchaseDate, setEditPurchaseDate] = useState('');
  const [editPurchaseCost, setEditPurchaseCost] = useState('');
  const [editCurrentWeight, setEditCurrentWeight] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editPhotoUrl, setEditPhotoUrl] = useState<string>('');
  const [editPhotoCompressing, setEditPhotoCompressing] = useState(false);
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // Add Activity / Event Modal state
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [eventModalAnimal, setEventModalAnimal] = useState<Animal | null>(null);
  const [isBulkMode, setIsBulkMode] = useState<boolean>(false);
  const [bulkSelectedAnimalIds, setBulkSelectedAnimalIds] = useState<string[]>([]);
  const [costAllocation, setCostAllocation] = useState<'PER_ANIMAL' | 'SPLIT_EVENLY'>('PER_ANIMAL');
  const [eventType, setEventType] = useState<AnimalEvent['eventType']>('FEED');
  const [eventDate, setEventDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [eventCost, setEventCost] = useState<string>('0');
  const [eventMilkLiters, setEventMilkLiters] = useState<string>('');
  const [eventWeightKg, setEventWeightKg] = useState<string>('');
  const [eventVaccineName, setEventVaccineName] = useState<string>('');
  const [eventNextDueDate, setEventNextDueDate] = useState<string>('');
  const [eventDetails, setEventDetails] = useState<string>('');
  const [eventPaymentMethod, setEventPaymentMethod] = useState<'CASH' | 'BANK'>('CASH');
  const [submittingEvent, setSubmittingEvent] = useState(false);

  // Animal Status / Sell / Remove Modal state
  const [statusModalAnimal, setStatusModalAnimal] = useState<Animal | null>(null);
  const [newStatus, setNewStatus] = useState<AnimalStatus>('SOLD');
  const [statusDate, setStatusDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [salePrice, setSalePrice] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [statusPaymentMethod, setStatusPaymentMethod] = useState<'CASH' | 'BANK'>('CASH');
  const [statusNotes, setStatusNotes] = useState<string>('');
  const [submittingStatus, setSubmittingStatus] = useState(false);

  // Animal History Modal state
  const [historyModalAnimal, setHistoryModalAnimal] = useState<Animal | null>(null);

  // Add Fish Batch
  const [showAddFish, setShowAddFish] = useState(false);
  const [pondName, setPondName] = useState('পুকুর নং ১ (উত্তর পাড়)');
  const [fishSpecies, setFishSpecies] = useState('পাঙ্গাশ ও তেলাপিয়া');
  const [fingerlingQty, setFingerlingQty] = useState('5000');
  const [fingerlingCost, setFingerlingCost] = useState('15000');

  // Add Crop Cycle
  const [showAddCrop, setShowAddCrop] = useState(false);
  const [plotName, setPlotName] = useState('প্লট এ (নেপিয়ার ঘাস)');
  const [cropName, setCropName] = useState('সুপার নেপিয়ার ঘাস');
  const [cropArea, setCropArea] = useState('33');

  // Add Internal Flow
  const [showAddFlow, setShowAddFlow] = useState(false);
  const [flowResource, setFlowResource] = useState<InternalFlow['resource']>('MANURE');
  const [flowSource, setFlowSource] = useState('শেড ১ (ডেইরি)');
  const [flowDestination, setFlowDestination] = useState('পুকুর ১');
  const [flowDesc, setFlowDesc] = useState('গোবর সার পুকুরে প্রয়োগ');
  const [flowQty, setFlowQty] = useState('500');
  const [flowValue, setFlowValue] = useState('1000');

  useEffect(() => {
    loadOpsData();
  }, [tab]);

  useEffect(() => {
    if (initialAnimalId) {
      setTab('livestock');
      setSelectedAnimalId(initialAnimalId);
    }
  }, [initialAnimalId]);

  useEffect(() => {
    if (initialAction?.openActivityModal) {
      setTab('livestock');
      if (initialAction.eventType) {
        setEventType(initialAction.eventType);
      }
      setIsBulkMode(false);
      setEventDate(new Date().toISOString().split('T')[0]);
      setEventCost('0');
      setEventMilkLiters('');
      setEventWeightKg('');
      setEventVaccineName('');
      setEventNextDueDate('');
      setEventDetails('');

      const targetId = initialAnimalId || selectedAnimalId;
      if (targetId) {
        const found = animals.find((a) => a.id === targetId);
        setEventModalAnimal(found || null);
      } else {
        setEventModalAnimal(null);
      }

      setIsEventModalOpen(true);
      onClearInitialAction?.();
    }
  }, [initialAction, animals, initialAnimalId, selectedAnimalId]);

  useEffect(() => {
    const handleDataChanged = () => {
      loadOpsData();
    };
    window.addEventListener('goted_data_changed', handleDataChanged);
    return () => window.removeEventListener('goted_data_changed', handleDataChanged);
  }, []);

  const loadOpsData = async () => {
    setLoading(true);
    try {
      // Seed default animals if empty
      let aList = await db.animals.toArray();
      if (aList.length === 0) {
        const seedA: Animal[] = [
          {
            id: 'COW-101',
            tag: 'TAG-101',
            species: 'CATTLE',
            breed: 'হলস্টাইন ফ্রিজিয়ান সংকর (Holstein Cross)',
            gender: 'FEMALE',
            birthDate: '2022-03-15',
            purchaseDate: '2023-01-10',
            purchaseCost: 85000,
            currentWeightKg: 380,
            accumulatedFeedCost: 24000,
            accumulatedMedCost: 3500,
            accumulatedLabourCost: 6000,
            otherCosts: 0,
            totalCost: 118500,
            status: 'ACTIVE',
            location: 'শেড নং ১',
            synced: false
          },
          {
            id: 'BULL-102',
            tag: 'TAG-102',
            species: 'CATTLE',
            breed: 'শাহীওয়াল ক্রস (Sahiwal)',
            gender: 'MALE',
            birthDate: '2023-01-20',
            purchaseDate: '2023-06-15',
            purchaseCost: 60000,
            currentWeightKg: 310,
            accumulatedFeedCost: 18000,
            accumulatedMedCost: 2000,
            accumulatedLabourCost: 4500,
            otherCosts: 0,
            totalCost: 84500,
            status: 'ACTIVE',
            location: 'শেড নং ২ (ফ্যাটেনিং)',
            synced: false
          }
        ];
        await db.animals.bulkPut(seedA);
        aList = seedA;
      }
      setAnimals(aList);

      const evList = await db.animalEvents.orderBy('date').reverse().toArray();
      setAnimalEvents(evList);

      // Seed default fish batches if empty
      let fList = await db.fishBatches.toArray();
      if (fList.length === 0) {
        const seedF: FishBatch[] = [
          {
            id: 'FISH-P1-24',
            pondId: 'p1',
            pondName: '১ নং প্রধান পুকুর (কার্প মিশ্র চাষ)',
            species: 'রুই, কাতলা ও মৃগেল',
            stockingDate: '2024-02-01',
            fingerlingQty: 3000,
            fingerlingCost: 18000,
            totalFeedKg: 1200,
            totalFeedCost: 68000,
            mortalityCount: 150,
            currentEstimatedWeightKg: 750,
            status: 'ACTIVE',
            synced: false
          }
        ];
        await db.fishBatches.bulkPut(seedF);
        fList = seedF;
      }
      setFishBatches(fList);

      // Seed default crop cycles if empty
      let cList = await db.cropCycles.toArray();
      if (cList.length === 0) {
        const seedC: CropCycle[] = [
          {
            id: 'CROP-NAP-01',
            plotId: 'plot1',
            plotName: 'দক্ষিণ খণ্ড (প্লট-১)',
            cropName: 'সুপার নেপিয়ার ঘাস (গবাদিপশুর খাদ্য)',
            cropCategory: 'FODDER',
            areaDecimals: 50,
            plantingDate: '2024-01-15',
            expectedHarvestDate: '2024-05-15',
            seedCost: 5000,
            fertilizerCost: 6500,
            irrigationCost: 2000,
            labourCost: 8000,
            otherCost: 0,
            totalCost: 21500,
            harvestYieldKg: 12000,
            harvestRevenue: 0,
            internalConsumptionKg: 12000,
            status: 'GROWING',
            synced: false
          }
        ];
        await db.cropCycles.bulkPut(seedC);
        cList = seedC;
      }
      setCropCycles(cList);

      if (tab === 'flows') {
        const flowList = await db.internalFlows.orderBy('date').reverse().toArray();
        setInternalFlows(flowList);
      } else if (tab === 'processing') {
        const prList = await db.processingRuns.orderBy('date').reverse().toArray();
        setProcessingRuns(prList);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const executeSaveAnimal = async (animalToSave: Animal) => {
    try {
      await safeInsert(db.animals, animalToSave, { idPrefix: 'COW' });
      setShowAddAnimal(false);
      setDuplicateTagWarning(null);
      setTagId('');
      setAnimalPhotoUrl('');
      setAnimalBirthDate(new Date().toISOString().split('T')[0]);
      setAnimalPurchaseDate(new Date().toISOString().split('T')[0]);
      setMsg({ type: 'success', text: `পশু ট্যাগ ${animalToSave.id} সফলভাবে যুক্ত হয়েছে!` });
      await loadOpsData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleAddAnimal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      if (animalBirthDate > todayStr) {
        setMsg({
          type: 'error',
          text: `পশুর জন্ম তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের হতে হবে)।`
        });
        return;
      }
      if (animalBirthDate && animalPurchaseDate && animalPurchaseDate < animalBirthDate) {
        setMsg({
          type: 'error',
          text: `পশুর ক্রয় তারিখ জন্ম তারিখের (${animalBirthDate}) পূর্ববর্তী হতে পারে না।`
        });
        return;
      }

      const pCost = parseFloat(purchaseCost) || 0;
      const anId = tagId.trim() || generateTransactionNumber('COW');
      const animal: Animal = {
        id: anId,
        tag: anId,
        species,
        breed: breed.trim(),
        gender,
        birthDate: animalBirthDate,
        purchaseDate: animalPurchaseDate,
        purchaseCost: pCost,
        currentWeightKg: parseFloat(currentWeight) || 0,
        accumulatedFeedCost: 0,
        accumulatedMedCost: 0,
        accumulatedLabourCost: 0,
        otherCosts: 0,
        totalCost: pCost,
        status: 'ACTIVE',
        location: 'প্রধান শেড',
        photoUrl: animalPhotoUrl.trim() ? animalPhotoUrl : undefined,
        synced: false
      };

      // Check tag field (case-insensitive) against all existing animals' tags
      const trimmedTag = anId.trim().toLowerCase();
      const isDuplicate = animals.some(
        (a) =>
          (a.tag && a.tag.trim().toLowerCase() === trimmedTag) ||
          (a.id && a.id.trim().toLowerCase() === trimmedTag)
      );

      if (isDuplicate) {
        setDuplicateTagWarning({
          tag: anId,
          animalData: animal
        });
        return;
      }

      await executeSaveAnimal(animal);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleOpenEditAnimal = (a: Animal) => {
    setEditingAnimal(a);
    setEditTag(a.tag || a.id);
    setEditSpecies((a.species as any) || 'CATTLE');
    setEditBreed(a.breed || '');
    setEditGender(a.gender || 'FEMALE');
    setEditBirthDate(a.birthDate || '');
    setEditPurchaseDate(a.purchaseDate || '');
    setEditPurchaseCost(String(a.purchaseCost || 0));
    setEditCurrentWeight(String(a.currentWeightKg || 0));
    setEditLocation(a.location || 'প্রধান শেড');
    setEditPhotoUrl(a.photoUrl || '');
  };

  const handleSaveEditAnimal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAnimal) return;

    try {
      setSubmittingEdit(true);
      const updatedFields: Partial<Animal> = {
        tag: editTag.trim() || editingAnimal.id,
        species: editSpecies as any,
        breed: editBreed.trim(),
        gender: editGender,
        birthDate: editBirthDate,
        purchaseDate: editPurchaseDate,
        purchaseCost: parseFloat(editPurchaseCost) || 0,
        currentWeightKg: parseFloat(editCurrentWeight) || 0,
        location: editLocation.trim() || 'প্রধান শেড',
        photoUrl: editPhotoUrl.trim() ? editPhotoUrl : undefined,
        synced: false
      };

      await db.animals.update(editingAnimal.id, updatedFields);
      setMsg({ type: 'success', text: `পশু ${editingAnimal.id} এর তথ্য ও ছবি সফলভাবে হালনাগাদ করা হয়েছে!` });
      setEditingAnimal(null);
      await loadOpsData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'পশুর তথ্য হালনাগাদ করা যায়নি।' });
    } finally {
      setSubmittingEdit(false);
    }
  };

  const activeAnimals = useMemo(() => {
    return animals.filter((a) => a.status === 'ACTIVE');
  }, [animals]);

  const handleCloseEventModal = () => {
    setIsEventModalOpen(false);
    setEventModalAnimal(null);
    setIsBulkMode(false);
    setBulkSelectedAnimalIds([]);
    setCostAllocation('PER_ANIMAL');
    setEventCost('0');
    setEventMilkLiters('');
    setEventWeightKg('');
    setEventVaccineName('');
    setEventNextDueDate('');
    setEventDetails('');
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEventModalOpen) return;

    const targetAnimals: Animal[] = isBulkMode
      ? activeAnimals.filter((a) => bulkSelectedAnimalIds.includes(a.id))
      : (eventModalAnimal ? [eventModalAnimal] : []);

    if (targetAnimals.length === 0) {
      setMsg({ type: 'error', text: 'অনুগ্রহ করে অন্তত একটি সক্রিয় পশু নির্বাচন করুন।' });
      return;
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const maxFutureDate = tomorrow.toISOString().split('T')[0];
    const chosenEventDate = eventDate || new Date().toISOString().split('T')[0];

    if (chosenEventDate > maxFutureDate) {
      setMsg({
        type: 'error',
        text: `কার্যক্রমের তারিখ সর্বোচ্চ ১ দিন ভবিষ্যতের হতে পারে (${maxFutureDate} এর পরে গ্রহণযোগ্য নয়)।`
      });
      return;
    }

    for (const an of targetAnimals) {
      if (an.purchaseDate && chosenEventDate < an.purchaseDate) {
        setMsg({
          type: 'error',
          text: `পশু ${an.tag || an.id} এর কার্যক্রমের তারিখ (${chosenEventDate}) এর ক্রয় তারিখের (${an.purchaseDate}) পূর্ববর্তী হতে পারে না।`
        });
        return;
      }
      if (an.birthDate && chosenEventDate < an.birthDate) {
        setMsg({
          type: 'error',
          text: `পশু ${an.tag || an.id} এর কার্যক্রমের তারিখ (${chosenEventDate}) এর জন্ম তারিখের (${an.birthDate}) পূর্ববর্তী হতে পারে না।`
        });
        return;
      }
    }

    setSubmittingEvent(true);
    try {
      const rawCost = Math.max(0, parseFloat(eventCost) || 0);
      const milk = eventType === 'MILK' && eventMilkLiters ? Math.max(0, parseFloat(eventMilkLiters) || 0) : undefined;
      const weight = eventType === 'WEIGHT' && eventWeightKg ? Math.max(0, parseFloat(eventWeightKg) || 0) : undefined;

      // Calculate cost allocation per animal
      const costPerAnimal = (isBulkMode && costAllocation === 'SPLIT_EVENLY')
        ? (targetAnimals.length > 0 ? Math.round((rawCost / targetAnimals.length) * 100) / 100 : 0)
        : rawCost;

      // Process each selected animal: one AnimalEvent (and matching journal entry) per selected animal
      for (let i = 0; i < targetAnimals.length; i++) {
        const animal = targetAnimals[i];
        const animalCost = (isBulkMode && costAllocation === 'SPLIT_EVENLY')
          ? (i === targetAnimals.length - 1
              ? Math.max(0, Math.round((rawCost - costPerAnimal * (targetAnimals.length - 1)) * 100) / 100)
              : costPerAnimal)
          : rawCost;

        const res = await executeAnimalEventTransaction({
          animal,
          event: {
            animalId: animal.id,
            eventType,
            date: eventDate || new Date().toISOString().split('T')[0],
            cost: animalCost,
            milkLiters: milk,
            weightKg: weight,
            vaccineName: (eventType === 'VACCINE' || eventType === 'TREATMENT') ? eventVaccineName.trim() || undefined : undefined,
            nextDueDate: (eventType === 'VACCINE' || eventType === 'TREATMENT') ? eventNextDueDate || undefined : undefined,
            details: eventDetails.trim() || `${eventType} কার্যক্রম সম্পন্ন${isBulkMode ? ' (একত্র এন্ট্রি)' : ''}`
          },
          paymentMethod: eventPaymentMethod,
          currentUserId
        });

        let autoReminderId: string | undefined;
        // Automatically create matching PENDING Reminder when nextDueDate is set
        if ((eventType === 'VACCINE' || eventType === 'TREATMENT') && eventNextDueDate) {
          const vaccineOrTreatment = eventType === 'VACCINE'
            ? (eventVaccineName.trim() || 'টিকা')
            : (eventDetails.trim() || 'চিকিৎসা');
          const animalTag = animal.tag || animal.id;
          autoReminderId = generateUniqueId('rem');
          const autoReminder: Reminder = {
            id: autoReminderId,
            animalId: animal.id,
            title: `${animalTag}: ${vaccineOrTreatment} পরবর্তী ডোজ/ফলোআপ`,
            category: eventType === 'VACCINE' ? 'VACCINE' : 'TREATMENT',
            dueDate: eventNextDueDate,
            status: 'PENDING',
            createdAt: new Date().toISOString(),
            synced: false
          };
          await safeInsert(db.reminders, autoReminder, { idPrefix: 'rem' });
        }

        notifyUndoableAction({
          type: 'ANIMAL_EVENT',
          eventId: res.event.id,
          journalEntryId: res.journalEntryId,
          animalId: animal.id,
          cost: animalCost,
          eventType,
          createdReminderId: autoReminderId,
          currentUserId
        });
      }

      const totalRecordedCost = (isBulkMode && costAllocation === 'SPLIT_EVENLY')
        ? rawCost
        : rawCost * targetAnimals.length;

      setMsg({
        type: 'success',
        text: isBulkMode
          ? `একত্রে ${targetAnimals.length}টি পশুর ${eventType} কার্যক্রম সফলভাবে যুক্ত ও সংরক্ষিত হয়েছে!${totalRecordedCost > 0 ? ` (মোট ব্যয় ৳${totalRecordedCost.toFixed(2)} জাবেদায় পোস্ট করা হয়েছে)` : ''}${eventNextDueDate ? ' (পরবর্তী তারিখের রিমাইন্ডার তৈরি করা হয়েছে)' : ''}`
          : `পশু ${targetAnimals[0].id} এর ${eventType} কার্যক্রম সফলভাবে যুক্ত ও সংরক্ষিত হয়েছে!${rawCost > 0 ? ` (ব্যয় ৳${rawCost} জাবেদায় পোস্ট করা হয়েছে)` : ''}${eventNextDueDate ? ' (পরবর্তী তারিখের রিমাইন্ডার তৈরি করা হয়েছে)' : ''}`
      });

      handleCloseEventModal();
      await loadOpsData();
    } catch (err: any) {
      setMsg({ type: 'error', text: `কার্যক্রম সংরক্ষণে ত্রুটি: ${err.message}` });
    } finally {
      setSubmittingEvent(false);
    }
  };

  const handleSaveStandaloneReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reminderTitle.trim()) {
      setMsg({ type: 'error', text: 'রিমাইন্ডারের শিরোনাম লিখুন।' });
      return;
    }
    try {
      const newReminder: Reminder = {
        id: generateUniqueId('rem'),
        title: reminderTitle.trim(),
        category: reminderCategory,
        dueDate: reminderDueDate || new Date().toISOString().split('T')[0],
        animalId: reminderAnimalId.trim() || undefined,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        synced: false
      };
      await safeInsert(db.reminders, newReminder, { idPrefix: 'rem' });
      setShowAddReminderModal(false);
      setReminderTitle('');
      setReminderCategory('MARKET');
      setReminderDueDate(new Date().toISOString().split('T')[0]);
      setReminderAnimalId('');
      setMsg({
        type: 'success',
        text: `রিমাইন্ডার "${newReminder.title}" সফলভাবে তৈরি হয়েছে!`
      });
    } catch (err: any) {
      setMsg({ type: 'error', text: `রিমাইন্ডার তৈরিতে ত্রুটি: ${err.message}` });
    }
  };

  const handleSaveStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalAnimal) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const chosenStatusDate = statusDate || todayStr;
    if (chosenStatusDate > todayStr) {
      setMsg({
        type: 'error',
        text: `তারিখ ভবিষ্যতের হতে পারে না (${todayStr} বা তার পূর্বের তারিখ নির্বাচন করুন)।`
      });
      return;
    }

    if (
      newStatus === 'SOLD' &&
      statusModalAnimal.purchaseDate &&
      chosenStatusDate < statusModalAnimal.purchaseDate
    ) {
      setMsg({
        type: 'error',
        text: `পশুর বিক্রয় তারিখ (${chosenStatusDate}) এর ক্রয় তারিখের (${statusModalAnimal.purchaseDate}) পূর্ববর্তী হতে পারে না।`
      });
      return;
    }

    setSubmittingStatus(true);
    try {
      const price = newStatus === 'SOLD' ? (parseFloat(salePrice) || 0) : undefined;
      if (newStatus === 'SOLD' && (!price || price <= 0)) {
        throw new Error('পশু বিক্রয়ের ক্ষেত্রে বিক্রয়মূল্য আবশ্যক!');
      }

      await executeAnimalSaleOrRemovalTransaction({
        animal: statusModalAnimal,
        newStatus,
        date: statusDate || new Date().toISOString().split('T')[0],
        salePrice: price,
        customerName: customerName.trim() || undefined,
        paymentMethod: statusPaymentMethod,
        notes: statusNotes.trim() || undefined,
        currentUserId
      });

      setMsg({
        type: 'success',
        text: newStatus === 'SOLD'
          ? `পশু ${statusModalAnimal.id} সফলভাবে বিক্রয় ও রাজস্ব জাবেদায় পোস্ট করা হয়েছে! (বিক্রয়মূল্য: ৳${price})`
          : `পশু ${statusModalAnimal.id} এর স্ট্যাটাস '${newStatus}' এ সফলভাবে হালনাগাদ করা হয়েছে!`
      });
      setStatusModalAnimal(null);
      setSalePrice('');
      setCustomerName('');
      setStatusNotes('');
      await loadOpsData();
    } catch (err: any) {
      setMsg({ type: 'error', text: `স্ট্যাটাস আপডেটে ত্রুটি: ${err.message}` });
    } finally {
      setSubmittingStatus(false);
    }
  };

  const handleAddFish = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const fCost = parseFloat(fingerlingCost) || 0;
      const batch: FishBatch = {
        id: generateTransactionNumber('FISH'),
        pondId: generateUniqueId('pond'),
        pondName: pondName.trim(),
        species: fishSpecies.trim(),
        stockingDate: new Date().toISOString().split('T')[0],
        fingerlingQty: parseInt(fingerlingQty) || 1000,
        fingerlingCost: fCost,
        totalFeedKg: 0,
        totalFeedCost: 0,
        mortalityCount: 0,
        currentEstimatedWeightKg: 0,
        status: 'ACTIVE',
        synced: false
      };
      await safeInsert(db.fishBatches, batch, { idPrefix: 'FISH' });
      setShowAddFish(false);
      setMsg({ type: 'success', text: `মাছের ব্যাচ ${batch.id} যুক্ত হয়েছে!` });
      loadOpsData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleAddCrop = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const cycle: CropCycle = {
        id: generateTransactionNumber('CROP'),
        plotId: generateUniqueId('plt'),
        plotName: plotName.trim(),
        cropName: cropName.trim(),
        cropCategory: 'FODDER',
        areaDecimals: parseFloat(cropArea) || 0,
        plantingDate: new Date().toISOString().split('T')[0],
        expectedHarvestDate: new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
        seedCost: 0,
        fertilizerCost: 0,
        irrigationCost: 0,
        labourCost: 0,
        otherCost: 0,
        totalCost: 0,
        harvestYieldKg: 0,
        harvestRevenue: 0,
        internalConsumptionKg: 0,
        status: 'GROWING',
        synced: false
      };
      await safeInsert(db.cropCycles, cycle, { idPrefix: 'CROP' });
      setShowAddCrop(false);
      setMsg({ type: 'success', text: `শস্য/ঘাস চক্র ${cycle.id} তৈরি হয়েছে!` });
      loadOpsData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleAddInternalFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const flow: InternalFlow = {
        id: generateUniqueId('flow'),
        date: new Date().toISOString().split('T')[0],
        resource: flowResource,
        source: flowSource.trim(),
        destination: flowDestination.trim(),
        quantity: parseFloat(flowQty) || 0,
        unit: 'কেজি',
        internalCostValuation: parseFloat(flowValue) || 0,
        notes: flowDesc.trim(),
        synced: false
      };
      await safeInsert(db.internalFlows, flow, { idPrefix: 'flow' });
      setShowAddFlow(false);
      setMsg({ type: 'success', text: 'অভ্যন্তরীণ স্থানান্তর রেকর্ড সম্পন্ন!' });
      loadOpsData();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const fmt = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4 pb-6 max-w-5xl mx-auto">
      {/* Header & Subtabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-white border border-gray-200 shadow-xs">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
            <Tractor className="w-5 h-5 text-[#1E5128]" />
            <span>সমন্বিত খামার ব্যবস্থাপনা (Agro Operations)</span>
          </h2>
          <p className="text-[14px] text-gray-600 mt-0.5">
            গরু-ছাগল ফ্যাটেনিং/দুগ্ধ খামার, মৎস্য হ্যাচারি, নেপিয়ার ঘাস, বায়ো-ফ্লো ও প্রসেসিং
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddReminderModal(true)}
            className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-[#1E5128] border border-emerald-200 text-[13px] font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5 min-h-[40px]"
          >
            <Clock className="w-4 h-4 text-[#1E5128]" />
            <span>+ নতুন রিমাইন্ডার</span>
          </button>

          <div className="flex items-center gap-1.5 bg-gray-100 p-1.5 rounded-xl overflow-x-auto text-[13px] font-semibold">
            <button
              onClick={() => {
                setTab('livestock');
                setSelectedAnimalId(null);
                if (onClearInitialAnimalId) onClearInitialAnimalId();
              }}
              className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
                tab === 'livestock' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
              }`}
            >
              গবাদিপশু (Livestock)
            </button>
            <button
              onClick={() => {
                setTab('fisheries');
                setSelectedAnimalId(null);
                if (onClearInitialAnimalId) onClearInitialAnimalId();
              }}
              className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
                tab === 'fisheries' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
              }`}
            >
              মৎস্য চাষ (Fisheries)
            </button>
            <button
              onClick={() => {
                setTab('crops');
                setSelectedAnimalId(null);
                if (onClearInitialAnimalId) onClearInitialAnimalId();
              }}
              className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
                tab === 'crops' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
              }`}
            >
              শস্য ও ঘাস (Crops)
            </button>
            <button
              onClick={() => {
                setTab('flows');
                setSelectedAnimalId(null);
                if (onClearInitialAnimalId) onClearInitialAnimalId();
              }}
              className={`px-3.5 py-2 rounded-lg whitespace-nowrap transition-all cursor-pointer min-h-[40px] ${
                tab === 'flows' ? 'bg-[#1E5128] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
              }`}
            >
              অভ্যন্তরীণ প্রবাহ (Flows)
            </button>
          </div>
        </div>
      </div>

      {msg && (
        <div
          className={`p-3.5 rounded-xl border text-[14px] font-medium flex items-center gap-2.5 ${
            msg.type === 'success'
              ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#15803D]'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {msg.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* ===================== TAB 1: LIVESTOCK ===================== */}
      {tab === 'livestock' && (
        <>
          {selectedAnimal ? (
            <AnimalDetailView
              animal={selectedAnimal}
              events={animalEvents}
              onBack={() => {
                setSelectedAnimalId(null);
                if (onClearInitialAnimalId) onClearInitialAnimalId();
              }}
              onAddEvent={(a) => {
                setEventModalAnimal(a);
                setIsBulkMode(false);
                setBulkSelectedAnimalIds([a.id]);
                setCostAllocation('PER_ANIMAL');
                setIsEventModalOpen(true);
                setEventType('FEED');
                setEventCost('0');
                setEventMilkLiters('');
                setEventWeightKg('');
                setEventVaccineName('');
                setEventNextDueDate('');
                setEventDetails('');
                setEventDate(new Date().toISOString().split('T')[0]);
                setEventPaymentMethod('CASH');
              }}
              onUpdateStatus={(a) => {
                setStatusModalAnimal(a);
                setNewStatus(a.status === 'ACTIVE' ? 'SOLD' : a.status);
                setStatusDate(new Date().toISOString().split('T')[0]);
                setSalePrice(a.salePrice ? String(a.salePrice) : '');
                setCustomerName('');
                setStatusNotes('');
                setStatusPaymentMethod('CASH');
              }}
              onEditAnimal={(a) => handleOpenEditAnimal(a)}
              role={role}
            />
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-100 pb-4 gap-3">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#1E5128]" />
                <span>গবাদিপশু প্রোফাইল ও উৎপাদন সূচক ({animals.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                প্রতিটি প্রাণীর স্বতন্ত্র ব্যয়, খাদ্য ও চিকিৎসা ট্র্যাকিং এবং কার্যক্রম ব্যবস্থাপনা
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Active / Inactive Filter Toggle */}
              <div className="flex items-center bg-gray-100 p-1 rounded-xl text-[13px] font-medium border border-gray-200">
                <button
                  type="button"
                  onClick={() => setAnimalFilter('ACTIVE')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer font-semibold ${
                    animalFilter === 'ACTIVE'
                      ? 'bg-white text-[#1E5128] shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  সক্রিয় পশু ({animals.filter((a) => a.status === 'ACTIVE').length})
                </button>
                <button
                  type="button"
                  onClick={() => setAnimalFilter('INACTIVE')}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer font-semibold ${
                    animalFilter === 'INACTIVE'
                      ? 'bg-white text-rose-700 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  নিষ্ক্রিয়/বিক্রিত ({animals.filter((a) => a.status !== 'ACTIVE').length})
                </button>
              </div>

              {/* Add Activity button (opens modal in bulk or single mode) */}
              <button
                type="button"
                onClick={() => {
                  const activeList = animals.filter((a) => a.status === 'ACTIVE');
                  setEventModalAnimal(activeList[0] || null);
                  setIsBulkMode(activeList.length > 1);
                  setBulkSelectedAnimalIds(activeList.map((a) => a.id));
                  setCostAllocation('PER_ANIMAL');
                  setIsEventModalOpen(true);
                  setEventType('FEED');
                  setEventCost('0');
                  setEventMilkLiters('');
                  setEventWeightKg('');
                  setEventVaccineName('');
                  setEventNextDueDate('');
                  setEventDetails('');
                  setEventDate(new Date().toISOString().split('T')[0]);
                  setEventPaymentMethod('CASH');
                }}
                className="px-3.5 py-2 rounded-xl bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4 text-[#1E5128]" />
                <span>+ কার্যক্রম এন্ট্রি</span>
              </button>

              {role === 'OWNER' && (
                <button
                  onClick={() => setShowAddAnimal(!showAddAnimal)}
                  className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>+ নতুন পশু নিবন্ধন</span>
                </button>
              )}
            </div>
          </div>

          {/* Animal Live Search Bar - Placed at Top of Animal List */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                id="animal-search-input"
                value={animalSearch}
                onChange={(e) => setAnimalSearch(e.target.value)}
                placeholder="পশুর ট্যাগ (যেমন: COW-105) বা নাম/জাত দিয়ে খুঁজুন..."
                className="w-full pl-10 pr-9 py-2 bg-[#F8FAFC] border border-gray-300 rounded-xl text-[14px] text-gray-900 focus:outline-none focus:border-[#1E5128] focus:bg-white transition-all min-h-[42px]"
              />
              {animalSearch && (
                <button
                  type="button"
                  id="btn-clear-animal-search"
                  onClick={() => setAnimalSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                  title="অনুসন্ধান মুছুন"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {animalSearch.trim() && (
              <div className="text-xs text-gray-500 font-medium whitespace-nowrap">
                ফলাফল:{' '}
                <span className="font-bold text-[#1E5128]">
                  {
                    animals.filter((a) => {
                      const matchesStatus = animalFilter === 'ACTIVE' ? a.status === 'ACTIVE' : a.status !== 'ACTIVE';
                      if (!matchesStatus) return false;
                      const q = animalSearch.toLowerCase().trim();
                      const tagMatch = (a.tag && a.tag.toLowerCase().includes(q)) || (a.id && a.id.toLowerCase().includes(q));
                      const nameMatch = ((a as any).name && (a as any).name.toLowerCase().includes(q)) || (a.notes && a.notes.toLowerCase().includes(q));
                      const breedMatch = a.breed && a.breed.toLowerCase().includes(q);
                      return tagMatch || nameMatch || breedMatch;
                    }).length
                  }
                </span>{' '}
                টি পশু
              </div>
            )}
          </div>

          {showAddAnimal && (
            <form onSubmit={handleAddAnimal} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন গবাদিপশু তথ্য যোগ করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                <div>
                  <input
                    type="text"
                    placeholder="ট্যাগ নং (যেমন: COW-105)"
                    value={tagId}
                    onChange={(e) => setTagId(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                  {tagId.trim() &&
                    animals.some(
                      (a) =>
                        (a.tag && a.tag.trim().toLowerCase() === tagId.trim().toLowerCase()) ||
                        (a.id && a.id.trim().toLowerCase() === tagId.trim().toLowerCase())
                    ) && (
                      <span className="text-[11px] text-amber-700 font-semibold block mt-1">
                        ⚠️ এই ট্যাগটি ইতিমধ্যে ব্যবহৃত হয়েছে
                      </span>
                    )}
                </div>
                <select
                  value={species}
                  onChange={(e) => setSpecies(e.target.value as any)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                >
                  <option value="CATTLE">গরু (Cattle)</option>
                  <option value="GOAT">ছাগল (Goat)</option>
                  <option value="SHEEP">ভেড়া (Sheep)</option>
                </select>
                <input
                  type="text"
                  placeholder="জাত (Breed)"
                  value={breed}
                  onChange={(e) => setBreed(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as any)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                >
                  <option value="FEMALE">মাদি (Female)</option>
                  <option value="MALE">মদ্দা (Male)</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">জন্ম তারিখ (Birth Date) *</label>
                  <input
                    type="date"
                    required
                    value={animalBirthDate}
                    onChange={(e) => setAnimalBirthDate(e.target.value)}
                    className={`w-full bg-white border rounded-lg p-2.5 text-[14px] text-gray-900 ${
                      animalBirthDate > new Date().toISOString().split('T')[0]
                        ? 'border-rose-500 bg-rose-50/20'
                        : 'border-gray-300'
                    }`}
                  />
                  {animalBirthDate > new Date().toISOString().split('T')[0] && (
                    <p className="text-[11px] text-rose-600 font-semibold mt-1">
                      জন্ম তারিখ ভবিষ্যতের হতে পারে না ({new Date().toISOString().split('T')[0]} বা তার পূর্বের হতে হবে)
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">ক্রয় তারিখ (Purchase Date) *</label>
                  <input
                    type="date"
                    required
                    value={animalPurchaseDate}
                    onChange={(e) => setAnimalPurchaseDate(e.target.value)}
                    className={`w-full bg-white border rounded-lg p-2.5 text-[14px] text-gray-900 ${
                      animalBirthDate && animalPurchaseDate && animalPurchaseDate < animalBirthDate
                        ? 'border-rose-500 bg-rose-50/20'
                        : 'border-gray-300'
                    }`}
                  />
                  {animalBirthDate && animalPurchaseDate && animalPurchaseDate < animalBirthDate && (
                    <p className="text-[11px] text-rose-600 font-semibold mt-1">
                      ক্রয় তারিখ জন্ম তারিখের ({animalBirthDate}) পূর্ববর্তী হতে পারে না
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">ক্রয়মূল্য ৳</label>
                  <input
                    type="number"
                    value={purchaseCost}
                    onChange={(e) => setPurchaseCost(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1">বর্তমান ওজন (কেজি)</label>
                  <input
                    type="number"
                    value={currentWeight}
                    onChange={(e) => setCurrentWeight(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddAnimal(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  নিবন্ধন করুন
                </button>
              </div>
            </form>
          )}

          {/* Animals Grid */}
          {(() => {
            const displayedAnimals = animals.filter((a) => {
              const matchesStatus = animalFilter === 'ACTIVE' ? a.status === 'ACTIVE' : a.status !== 'ACTIVE';
              if (!matchesStatus) return false;
              if (!animalSearch.trim()) return true;
              const q = animalSearch.toLowerCase().trim();
              const tagMatch = (a.tag && a.tag.toLowerCase().includes(q)) || (a.id && a.id.toLowerCase().includes(q));
              const nameMatch = (a as any).name && (a as any).name.toLowerCase().includes(q);
              const breedMatch = a.breed && a.breed.toLowerCase().includes(q);
              return tagMatch || nameMatch || breedMatch;
            });

            if (displayedAnimals.length === 0) {
              return (
                <div className="p-8 text-center bg-gray-50 border border-dashed border-gray-300 rounded-xl text-gray-500">
                  <p className="text-[15px] font-medium">
                    {animalSearch.trim()
                      ? `"${animalSearch}" দিয়ে কোনো পশু খুঁজে পাওয়া যায়নি।`
                      : animalFilter === 'ACTIVE'
                      ? 'কোনো সক্রিয় গবাদিপশু নেই। নতুন পশু নিবন্ধন করতে উপরের বাটনে ক্লিক করুন।'
                      : 'কোনো নিষ্ক্রিয় বা বিক্রিত পশুর রেকর্ড নেই।'}
                  </p>
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {displayedAnimals.map((a) => {
                  const eventsForAnimal = animalEvents.filter((ev) => ev.animalId === a.id);
                  const isInactive = a.status !== 'ACTIVE';

                  return (
                    <div
                      key={a.id}
                      onClick={() => setSelectedAnimalId(a.id)}
                      className={`p-4 rounded-xl border space-y-3 shadow-xs transition-all flex flex-col justify-between cursor-pointer hover:shadow-md hover:border-[#1E5128]/50 ${
                        isInactive
                          ? 'bg-gray-50/90 border-gray-300 hover:bg-gray-100/80'
                          : 'bg-[#F8FAFC] border-gray-200 hover:bg-emerald-50/20'
                      }`}
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono font-bold text-[#1E5128] text-[15px]">{a.id}</span>
                              {isInactive && (
                                <span
                                  className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wide ${
                                    a.status === 'SOLD'
                                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                      : a.status === 'DECEASED'
                                      ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                      : a.status === 'STOLEN'
                                      ? 'bg-purple-100 text-purple-800 border border-purple-300'
                                      : 'bg-blue-100 text-blue-800 border border-blue-300'
                                  }`}
                                >
                                  {a.status === 'SOLD'
                                    ? 'বিক্রিত (SOLD)'
                                    : a.status === 'DECEASED'
                                    ? 'মৃত (DECEASED)'
                                    : a.status === 'STOLEN'
                                    ? 'চুরি/হারানো (STOLEN)'
                                    : 'স্থানান্তরিত (TRANSFERRED)'}
                                </span>
                              )}
                            </div>
                            <h4 className="font-bold text-gray-900 text-[14px] mt-0.5">{a.breed}</h4>
                          </div>
                          <span className="px-2.5 py-1 rounded-full bg-white border border-gray-200 text-xs text-gray-700 font-semibold shrink-0">
                            {a.gender === 'FEMALE' ? 'গাভী' : 'ষাঁড়'} ({a.currentWeightKg} কেজি)
                          </span>
                        </div>

                        {/* Cost & Financial Breakdown */}
                        <div className="space-y-1.5 text-[13px] pt-2 border-t border-gray-200">
                          <div className="flex justify-between">
                            <span className="text-gray-600">ক্রয়মূল্য:</span>
                            <span className="font-semibold text-gray-900">{fmt(a.purchaseCost)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">খাদ্য খরচ:</span>
                            <span className="font-semibold text-amber-700">{fmt(a.accumulatedFeedCost)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">চিকিৎসা ও টিকা:</span>
                            <span className="font-semibold text-blue-700">{fmt(a.accumulatedMedCost)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">লেবার ও অন্যান্য:</span>
                            <span className="font-semibold text-gray-900">
                              {fmt(a.accumulatedLabourCost + (a.otherCosts || 0))}
                            </span>
                          </div>
                          <div className="flex justify-between font-bold text-gray-900 pt-1.5 border-t border-gray-200 text-[14px]">
                            <span>মোট পুঞ্জীভূত খরচ:</span>
                            <span className="text-[#15803D]">{fmt(a.totalCost)}</span>
                          </div>

                          {a.status === 'SOLD' && (
                            <div className="flex justify-between font-bold text-amber-900 pt-1.5 border-t border-amber-200 text-[13px] bg-amber-50/80 px-2.5 py-1.5 rounded-lg">
                              <span>বিক্রয়মূল্য ({a.saleDate || 'তারিখ অপ্রাপ্ত'}):</span>
                              <span className="text-amber-700">{fmt(a.salePrice || 0)}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons: "+ কার্যক্রম যোগ করুন" and "পশু বিক্রি/হারানো" */}
                      <div className="pt-2.5 border-t border-gray-200 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEventModalAnimal(a);
                              setIsBulkMode(false);
                              setBulkSelectedAnimalIds([a.id]);
                              setCostAllocation('PER_ANIMAL');
                              setIsEventModalOpen(true);
                              setEventType('FEED');
                              setEventCost('0');
                              setEventMilkLiters('');
                              setEventWeightKg('');
                              setEventVaccineName('');
                              setEventNextDueDate('');
                              setEventDetails('');
                              setEventDate(new Date().toISOString().split('T')[0]);
                              setEventPaymentMethod('CASH');
                            }}
                            className="w-full py-2 px-2 rounded-lg bg-[#1E5128] hover:bg-[#173F1F] text-white text-[12px] font-bold shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1 min-h-[38px]"
                          >
                            <PlusCircle className="w-3.5 h-3.5 shrink-0" />
                            <span className="whitespace-nowrap">+ কার্যক্রম যোগ করুন</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setStatusModalAnimal(a);
                              setNewStatus(a.status === 'ACTIVE' ? 'SOLD' : a.status);
                              setStatusDate(new Date().toISOString().split('T')[0]);
                              setSalePrice(a.salePrice ? String(a.salePrice) : '');
                              setCustomerName('');
                              setStatusNotes('');
                              setStatusPaymentMethod('CASH');
                            }}
                            className="w-full py-2 px-2 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-[12px] font-bold shadow-xs transition-all cursor-pointer flex items-center justify-center gap-1 min-h-[38px]"
                          >
                            <Tag className="w-3.5 h-3.5 shrink-0 text-amber-700" />
                            <span className="whitespace-nowrap">পশু বিক্রি/হারানো</span>
                          </button>
                        </div>

                        {eventsForAnimal.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setHistoryModalAnimal(a);
                            }}
                            className="w-full py-1.5 px-2 rounded-lg bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 text-[12px] font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <History className="w-3.5 h-3.5 text-gray-500" />
                            <span>কার্যক্রম ইতিহাস ({eventsForAnimal.length}টি)</span>
                          </button>
                        )}

                        {/* Tap to view detail link */}
                        <div className="flex items-center justify-between pt-1 border-t border-dashed border-gray-200 text-[12px] font-semibold text-[#1E5128]">
                          <span>বিস্তারিত তথ্য, ওজন চার্ট ও দুধ উৎপাদন</span>
                          <span>→</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
            </div>
          )}

          {/* ================= MODAL 1: ADD ACTIVITY / EVENT (SINGLE & BULK MODE) ================= */}
          {isEventModalOpen && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
              <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-gray-200 my-8 space-y-4">
                <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                  <div>
                    <h4 className="text-[17px] font-bold text-gray-900 flex items-center gap-2">
                      <PlusCircle className="w-5 h-5 text-[#1E5128]" />
                      <span>
                        {isBulkMode
                          ? `একাধিক পশুর কার্যক্রম যোগ করুন (${bulkSelectedAnimalIds.length}টি নির্বাচিত)`
                          : eventModalAnimal
                          ? `কার্যক্রম যোগ করুন: ${eventModalAnimal.id}`
                          : 'কার্যক্রম যোগ করুন'}
                      </span>
                    </h4>
                    <p className="text-[13px] text-gray-600 mt-0.5">
                      {isBulkMode
                        ? 'নির্বাচিত প্রতিটি পশুর জন্য আলাদা কার্যক্রম ও জাবেদা ভাউচার তৈরি হবে'
                        : eventModalAnimal
                        ? `জাত: ${eventModalAnimal.breed || ''} | বর্তমান ওজন: ${eventModalAnimal.currentWeightKg || ''} কেজি`
                        : 'নিচে পশুটি নির্বাচন করে কার্যক্রমের বিবরণ দিন'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCloseEventModal}
                    className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSaveEvent} className="space-y-3.5">
                  {/* Toggle: "একাধিক পশুর জন্য" (For multiple animals) */}
                  <div className="flex items-center justify-between p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl">
                    <div className="flex items-center gap-2.5">
                      <Users className="w-5 h-5 text-[#1E5128]" />
                      <div>
                        <div className="text-[13px] font-bold text-gray-900">
                          একাধিক পশুর জন্য
                        </div>
                        <div className="text-[11px] text-gray-600">
                          {isBulkMode
                            ? 'একত্রে একাধিক সক্রিয় পশুর জন্য এন্ট্রি মোড চালু আছে'
                            : 'একক পশুর পরিবর্তে একাধিক পশুর জন্য একসাথে এন্ট্রি করতে চালু করুন'}
                        </div>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isBulkMode}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setIsBulkMode(checked);
                          if (checked) {
                            if (bulkSelectedAnimalIds.length === 0) {
                              if (eventModalAnimal) {
                                setBulkSelectedAnimalIds([eventModalAnimal.id]);
                              } else {
                                setBulkSelectedAnimalIds(activeAnimals.map((a) => a.id));
                              }
                            }
                          } else {
                            if (!eventModalAnimal && bulkSelectedAnimalIds.length > 0) {
                              const found = animals.find((a) => a.id === bulkSelectedAnimalIds[0]);
                              if (found) setEventModalAnimal(found);
                            }
                          }
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1E5128]"></div>
                    </label>
                  </div>

                  {/* Animal Context: Checklist of all ACTIVE animals OR Single Animal Details */}
                  {isBulkMode ? (
                    <div className="space-y-2 border border-gray-200 rounded-xl p-3 bg-gray-50/70">
                      <div className="flex items-center justify-between">
                        <label className="text-[12px] font-bold text-gray-800 flex items-center gap-1.5">
                          <CheckSquare className="w-4 h-4 text-[#1E5128]" />
                          <span>
                            সক্রিয় পশুর তালিকা ({activeAnimals.length}টির মধ্যে {bulkSelectedAnimalIds.length}টি নির্বাচিত):
                          </span>
                        </label>
                        <div className="flex items-center gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={() => setBulkSelectedAnimalIds(activeAnimals.map((a) => a.id))}
                            className="text-[#1E5128] hover:underline font-bold cursor-pointer"
                          >
                            সবগুলো নির্বাচন
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            type="button"
                            onClick={() => setBulkSelectedAnimalIds([])}
                            className="text-gray-500 hover:underline cursor-pointer"
                          >
                            সব বাতিল
                          </button>
                        </div>
                      </div>

                      {/* Checklist of all ACTIVE animals */}
                      <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white shadow-2xs">
                        {activeAnimals.length > 0 ? (
                          activeAnimals.map((animal) => {
                            const isSelected = bulkSelectedAnimalIds.includes(animal.id);
                            return (
                              <label
                                key={animal.id}
                                className={`flex items-center justify-between px-3 py-2 cursor-pointer text-[12px] transition-colors ${
                                  isSelected ? 'bg-emerald-50/80 font-medium text-gray-900' : 'hover:bg-gray-50 text-gray-700'
                                }`}
                              >
                                <div className="flex items-center gap-2.5">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setBulkSelectedAnimalIds((prev) => [...prev, animal.id]);
                                      } else {
                                        setBulkSelectedAnimalIds((prev) => prev.filter((id) => id !== animal.id));
                                      }
                                    }}
                                    className="rounded border-gray-300 text-[#1E5128] focus:ring-[#1E5128] w-4 h-4 cursor-pointer"
                                  />
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono font-bold text-gray-900">{animal.id}</span>
                                      {animal.tag && (
                                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] font-mono border border-gray-200">
                                          {animal.tag}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-gray-500">
                                      {animal.species === 'CATTLE' ? 'গরু' : animal.species === 'GOAT' ? 'ছাগল' : animal.species}
                                      {animal.breed ? ` • ${animal.breed}` : ''}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right text-[11px] text-gray-500 font-mono">
                                  {animal.currentWeightKg ? `${animal.currentWeightKg} কেজি` : ''}
                                </div>
                              </label>
                            );
                          })
                        ) : (
                          <div className="p-4 text-center text-[12px] text-gray-500">
                            কোনো সক্রিয় পশু পাওয়া যায়নি।
                          </div>
                        )}
                      </div>
                      {bulkSelectedAnimalIds.length === 0 && (
                        <p className="text-[11px] text-rose-600 font-medium">
                          * অনুগ্রহ করে কার্যক্রম প্রয়োগের জন্য অন্তত একটি পশু নির্বাচন করুন।
                        </p>
                      )}
                    </div>
                  ) : (
                    !eventModalAnimal ? (
                      <div className="space-y-1.5 p-3.5 bg-emerald-50/70 border-2 border-emerald-300 rounded-xl">
                        <label className="block text-[13px] font-bold text-gray-900 flex items-center justify-between">
                          <span>১. পশু নির্বাচন করুন (Select Animal) *</span>
                          <span className="text-[11px] text-emerald-700 font-normal">
                            {activeAnimals.length}টি সক্রিয় পশু উপলব্ধ
                          </span>
                        </label>
                        <select
                          id="select-event-target-animal"
                          value=""
                          onChange={(e) => {
                            const found = activeAnimals.find((a) => a.id === e.target.value);
                            if (found) setEventModalAnimal(found);
                          }}
                          className="w-full px-3 py-2.5 bg-white border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:ring-2 focus:ring-[#1E5128]"
                          required
                        >
                          <option value="">-- যে পশুর জন্য কার্যক্রম তা নির্বাচন করুন --</option>
                          {activeAnimals.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.id} {a.tag ? `(ট্যাগ: ${a.tag})` : ''} - {a.species === 'CATTLE' ? 'গরু' : a.species === 'GOAT' ? 'ছাগল' : a.species} {a.breed ? `[${a.breed}]` : ''}
                            </option>
                          ))}
                        </select>
                        <p className="text-[11px] text-gray-500">
                          কার্যক্রম যুক্ত করতে অনুগ্রহ করে প্রথমে পশুটি বাছাই করুন।
                        </p>
                      </div>
                    ) : (
                      <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-gray-900 text-[15px]">
                              {eventModalAnimal.id}
                            </span>
                            {eventModalAnimal.tag && (
                              <span className="px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-700 text-[11px] font-mono">
                                {eventModalAnimal.tag}
                              </span>
                            )}
                          </div>
                          <p className="text-[12px] text-gray-600 mt-0.5">
                            জাত: {eventModalAnimal.breed} | বর্তমান ওজন: {eventModalAnimal.currentWeightKg} কেজি
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEventModalAnimal(null)}
                          className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 px-2.5 py-1 rounded-md cursor-pointer transition-colors"
                        >
                          পশু পরিবর্তন
                        </button>
                      </div>
                    )
                  )}

                  {/* Shared Fields: Event Type & Date */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                        কার্যক্রমের ধরন (Event Type) *
                      </label>
                      <select
                        value={eventType}
                        onChange={(e) => setEventType(e.target.value as any)}
                        className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-medium focus:ring-2 focus:ring-[#1E5128]"
                      >
                        <option value="FEED">খাদ্য প্রদান (FEED)</option>
                        <option value="VACCINE">টিকা প্রদান (VACCINE)</option>
                        <option value="TREATMENT">চিকিৎসা ও ওষুধ (TREATMENT)</option>
                        <option value="WEIGHT">ওজন পরিমাপ (WEIGHT)</option>
                        <option value="MILK">দুধ উৎপাদন (MILK)</option>
                        <option value="BREEDING">প্রজনন / এআই (BREEDING)</option>
                        <option value="MORTALITY">মৃত্যু / মরটালিটি (MORTALITY)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[13px] font-semibold text-gray-700 mb-1">তারিখ (Date) *</label>
                      <input
                        type="date"
                        required
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        className={`w-full bg-white border rounded-lg p-2.5 text-[14px] text-gray-900 focus:ring-2 focus:ring-[#1E5128] ${
                          (() => {
                            const tomorrow = new Date();
                            tomorrow.setDate(tomorrow.getDate() + 1);
                            const maxFuture = tomorrow.toISOString().split('T')[0];
                            if (eventDate > maxFuture) return 'border-rose-500 bg-rose-50/20';
                            if (!isBulkMode && eventModalAnimal) {
                              if (eventModalAnimal.purchaseDate && eventDate < eventModalAnimal.purchaseDate) return 'border-rose-500 bg-rose-50/20';
                              if (eventModalAnimal.birthDate && eventDate < eventModalAnimal.birthDate) return 'border-rose-500 bg-rose-50/20';
                            }
                            return 'border-gray-300';
                          })()
                        }`}
                      />
                      {(() => {
                        const tomorrow = new Date();
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        const maxFuture = tomorrow.toISOString().split('T')[0];
                        if (eventDate > maxFuture) {
                          return (
                            <p className="text-[11px] text-rose-600 font-semibold mt-1">
                              কার্যক্রমের তারিখ সর্বোচ্চ ১ দিন ভবিষ্যতের হতে পারে ({maxFuture} এর পরে গ্রহণযোগ্য নয়)
                            </p>
                          );
                        }
                        if (!isBulkMode && eventModalAnimal) {
                          if (eventModalAnimal.purchaseDate && eventDate < eventModalAnimal.purchaseDate) {
                            return (
                              <p className="text-[11px] text-rose-600 font-semibold mt-1">
                                কার্যক্রমের তারিখ ({eventDate}) পশুর ক্রয় তারিখের ({eventModalAnimal.purchaseDate}) পূর্ববর্তী হতে পারে না
                              </p>
                            );
                          }
                          if (eventModalAnimal.birthDate && eventDate < eventModalAnimal.birthDate) {
                            return (
                              <p className="text-[11px] text-rose-600 font-semibold mt-1">
                                কার্যক্রমের তারিখ ({eventDate}) পশুর জন্ম তারিখের ({eventModalAnimal.birthDate}) পূর্ববর্তী হতে পারে না
                              </p>
                            );
                          }
                        }
                        return null;
                      })()}
                    </div>
                  </div>

                  {/* Shared Field: Cost Field */}
                  <div className="space-y-2">
                    <label className="block text-[13px] font-semibold text-gray-700">
                      খরচ (Cost ৳)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={eventCost}
                      onChange={(e) => setEventCost(e.target.value)}
                      placeholder="0"
                      className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-mono focus:ring-2 focus:ring-[#1E5128]"
                    />

                    {/* Small Radio Choice for Cost Allocation (Bulk Mode only) */}
                    {isBulkMode && (
                      <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                        <label className="block text-[12px] font-bold text-gray-700">
                          খরচ বণ্টনের পদ্ধতি (Cost Allocation):
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label
                            className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-[12px] font-medium transition-all ${
                              costAllocation === 'PER_ANIMAL'
                                ? 'border-[#1E5128] bg-emerald-50 text-[#1E5128] shadow-2xs'
                                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="costAllocation"
                              value="PER_ANIMAL"
                              checked={costAllocation === 'PER_ANIMAL'}
                              onChange={() => setCostAllocation('PER_ANIMAL')}
                              className="text-[#1E5128] focus:ring-[#1E5128]"
                            />
                            <span>প্রতি পশুর খরচ (per animal)</span>
                          </label>

                          <label
                            className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-[12px] font-medium transition-all ${
                              costAllocation === 'SPLIT_EVENLY'
                                ? 'border-[#1E5128] bg-emerald-50 text-[#1E5128] shadow-2xs'
                                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="costAllocation"
                              value="SPLIT_EVENLY"
                              checked={costAllocation === 'SPLIT_EVENLY'}
                              onChange={() => setCostAllocation('SPLIT_EVENLY')}
                              className="text-[#1E5128] focus:ring-[#1E5128]"
                            />
                            <span>মোট খরচ সমান ভাগ (total split evenly)</span>
                          </label>
                        </div>

                        {/* Informative real-time breakdown calculation */}
                        {parseFloat(eventCost) > 0 && bulkSelectedAnimalIds.length > 0 && (
                          <div className="text-[11px] text-gray-600 bg-white p-2.5 rounded-lg border border-gray-200 space-y-0.5">
                            {costAllocation === 'PER_ANIMAL' ? (
                              <div>
                                <span className="font-semibold text-gray-800">হিসাব:</span>{' '}
                                প্রতি পশুতে ৳{parseFloat(eventCost)} × {bulkSelectedAnimalIds.length}টি পশু ={' '}
                                <strong className="text-[#1E5128]">
                                  সর্বমোট ৳{(parseFloat(eventCost) * bulkSelectedAnimalIds.length).toFixed(2)}
                                </strong>{' '}
                                (প্রত্যেক পশুর অনুকূলে ৳{parseFloat(eventCost)} জাবেদা হবে)
                              </div>
                            ) : (
                              <div>
                                <span className="font-semibold text-gray-800">হিসাব:</span>{' '}
                                মোট ৳{parseFloat(eventCost)} ÷ {bulkSelectedAnimalIds.length}টি পশু ={' '}
                                <strong className="text-[#1E5128]">
                                  প্রতি পশুতে ৳{(parseFloat(eventCost) / bulkSelectedAnimalIds.length).toFixed(2)}
                                </strong>{' '}
                                (প্রত্যেক পশুর অনুকূলে সমান ভাগে জাবেদা হবে)
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {parseFloat(eventCost) > 0 && (
                      <p className="text-[12px] text-gray-500 mt-1">
                        {eventType === 'FEED'
                          ? 'স্বয়ংক্রিয়ভাবে ৬০১০ (খাদ্য খরচ) ডেবিট ও ক্যাশ/ব্যাংক ক্রেডিট হবে।'
                          : eventType === 'VACCINE'
                          ? 'স্বয়ংক্রিয়ভাবে ৬০৫০ (টিকা খরচ) ডেবিট ও ক্যাশ/ব্যাংক ক্রেডিট হবে।'
                          : eventType === 'TREATMENT'
                          ? 'স্বয়ংক্রিয়ভাবে ৬০৪০ (চিকিৎসা ও ওষুধ খরচ) ডেবিট ও ক্যাশ/ব্যাংক ক্রেডিট হবে।'
                          : 'স্বয়ংক্রিয়ভাবে বিবিধ পরিচালন ব্যয় ডেবিট ও ক্যাশ/ব্যাংক ক্রেডিট হবে।'}
                      </p>
                    )}
                  </div>

                  {/* Payment Method Selector if cost > 0 */}
                  {parseFloat(eventCost) > 0 && (
                    <div>
                      <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                        পরিশোধের মাধ্যম (Payment Account)
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-[13px] font-medium ${
                          eventPaymentMethod === 'CASH' ? 'border-[#1E5128] bg-[#F0FDF4] text-[#1E5128]' : 'border-gray-300'
                        }`}>
                          <input
                            type="radio"
                            name="evtPayment"
                            value="CASH"
                            checked={eventPaymentMethod === 'CASH'}
                            onChange={() => setEventPaymentMethod('CASH')}
                            className="text-[#1E5128]"
                          />
                          <span>নগদ টাকা (Cash 1010)</span>
                        </label>
                        <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-[13px] font-medium ${
                          eventPaymentMethod === 'BANK' ? 'border-[#1E5128] bg-[#F0FDF4] text-[#1E5128]' : 'border-gray-300'
                        }`}>
                          <input
                            type="radio"
                            name="evtPayment"
                            value="BANK"
                            checked={eventPaymentMethod === 'BANK'}
                            onChange={() => setEventPaymentMethod('BANK')}
                            className="text-[#1E5128]"
                          />
                          <span>ব্যাংক হিসাব (Bank 1030)</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* MILK LITERS (Only if eventType === 'MILK') */}
                  {eventType === 'MILK' && (
                    <div>
                      <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                        দুধের পরিমাণ (Milk Liters) *
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="যেমন: ১২.৫"
                        value={eventMilkLiters}
                        onChange={(e) => setEventMilkLiters(e.target.value)}
                        className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 focus:ring-2 focus:ring-[#1E5128]"
                      />
                    </div>
                  )}

                  {/* WEIGHT KG (Only if eventType === 'WEIGHT') */}
                  {eventType === 'WEIGHT' && (
                    <div>
                      <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                        পরিমাপকৃত নতুন ওজন (Weight Kg) *
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="যেমন: ৩৭০"
                        value={eventWeightKg}
                        onChange={(e) => setEventWeightKg(e.target.value)}
                        className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 focus:ring-2 focus:ring-[#1E5128]"
                      />
                      <p className="text-[12px] text-gray-500 mt-1">
                        সংরক্ষণ করলে পশুর বর্তমান ওজন স্বয়ংক্রিয়ভাবে আপডেট হবে।
                      </p>
                    </div>
                  )}

                  {/* VACCINE OR TREATMENT FIELDS (Only if eventType === 'VACCINE' or 'TREATMENT') */}
                  {(eventType === 'VACCINE' || eventType === 'TREATMENT') && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-blue-50/60 border border-blue-200 rounded-xl">
                      <div>
                        <label className="block text-[13px] font-semibold text-blue-900 mb-1">
                          টিকা বা ওষুধের নাম (Vaccine Name)
                        </label>
                        <input
                          type="text"
                          placeholder="যেমন: ক্ষুরা রোগ (FMD) / কৃমিনাশক"
                          value={eventVaccineName}
                          onChange={(e) => setEventVaccineName(e.target.value)}
                          className="w-full bg-white border border-blue-300 rounded-lg p-2.5 text-[14px] text-gray-900 focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                      <div>
                        <label className="block text-[13px] font-semibold text-blue-900 mb-1">
                          পরবর্তী ডোজের তারিখ (Next Due Date)
                        </label>
                        <input
                          type="date"
                          value={eventNextDueDate}
                          onChange={(e) => setEventNextDueDate(e.target.value)}
                          className="w-full bg-white border border-blue-300 rounded-lg p-2.5 text-[14px] text-gray-900 focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                    </div>
                  )}

                  {/* Details / Notes Text */}
                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                      বিবরণ বা নোটস (Details / Notes)
                    </label>
                    <textarea
                      rows={2}
                      value={eventDetails}
                      onChange={(e) => setEventDetails(e.target.value)}
                      placeholder="কার্যক্রমের বিবরণ বা নোট লিখুন..."
                      className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 focus:ring-2 focus:ring-[#1E5128]"
                    />
                  </div>

                  <div className="flex justify-end gap-2.5 pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      disabled={submittingEvent}
                      onClick={handleCloseEventModal}
                      className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                    >
                      বাতিল
                    </button>
                    <button
                      type="submit"
                      disabled={submittingEvent || (isBulkMode && bulkSelectedAnimalIds.length === 0)}
                      className="px-5 py-2.5 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold cursor-pointer shadow-xs min-h-[40px] disabled:opacity-50"
                    >
                      {submittingEvent
                        ? 'সংরক্ষণ হচ্ছে...'
                        : isBulkMode
                        ? `${bulkSelectedAnimalIds.length}টি পশুর জন্য সংরক্ষণ করুন`
                        : 'কার্যক্রম সংরক্ষণ করুন'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ================= MODAL 2: SELL / REMOVE ANIMAL ================= */}
          {statusModalAnimal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
              <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-gray-200 my-8 space-y-4">
                <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                  <div>
                    <h4 className="text-[17px] font-bold text-gray-900 flex items-center gap-2">
                      <Tag className="w-5 h-5 text-amber-600" />
                      <span>পশু বিক্রি বা অপসারণ: {statusModalAnimal.id}</span>
                    </h4>
                    <p className="text-[13px] text-gray-600 mt-0.5">
                      জাত: {statusModalAnimal.breed} | বর্তমান মোট পুঞ্জীভূত খরচ: {fmt(statusModalAnimal.totalCost)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStatusModalAnimal(null)}
                    className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSaveStatus} className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                        নতুন স্ট্যাটাস (Status) *
                      </label>
                      <select
                        value={newStatus}
                        onChange={(e) => setNewStatus(e.target.value as any)}
                        className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-medium focus:ring-2 focus:ring-amber-500"
                      >
                        <option value="SOLD">বিক্রয় (SOLD)</option>
                        <option value="DECEASED">মৃত (DECEASED)</option>
                        <option value="TRANSFERRED">স্থানান্তর (TRANSFERRED)</option>
                        <option value="STOLEN">চুরি / হারানো (STOLEN)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[13px] font-semibold text-gray-700 mb-1">তারিখ (Date) *</label>
                      <input
                        type="date"
                        required
                        value={statusDate}
                        onChange={(e) => setStatusDate(e.target.value)}
                        className={`w-full bg-white border rounded-lg p-2.5 text-[14px] text-gray-900 focus:ring-2 focus:ring-amber-500 ${
                          (() => {
                            const todayStr = new Date().toISOString().split('T')[0];
                            if (statusDate > todayStr) return 'border-rose-500 bg-rose-50/20';
                            if (newStatus === 'SOLD' && statusModalAnimal?.purchaseDate && statusDate < statusModalAnimal.purchaseDate) {
                              return 'border-rose-500 bg-rose-50/20';
                            }
                            return 'border-gray-300';
                          })()
                        }`}
                      />
                      {(() => {
                        const todayStr = new Date().toISOString().split('T')[0];
                        if (statusDate > todayStr) {
                          return (
                            <p className="text-[11px] text-rose-600 font-semibold mt-1">
                              তারিখ ভবিষ্যতের হতে পারে না ({todayStr} বা তার পূর্বের হতে হবে)
                            </p>
                          );
                        }
                        if (newStatus === 'SOLD' && statusModalAnimal?.purchaseDate && statusDate < statusModalAnimal.purchaseDate) {
                          return (
                            <p className="text-[11px] text-rose-600 font-semibold mt-1">
                              বিক্রয় তারিখ ({statusDate}) পশুর ক্রয় তারিখের ({statusModalAnimal.purchaseDate}) পূর্ববর্তী হতে পারে না
                            </p>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>

                  {/* IF SOLD: SALE PRICE & PAYMENT & CUSTOMER */}
                  {newStatus === 'SOLD' && (
                    <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl space-y-3">
                      <div className="font-bold text-amber-900 text-[14px] flex items-center gap-1.5">
                        <DollarSign className="w-4 h-4 text-amber-700" />
                        <span>বিক্রয় চালান ও রাজস্ব তথ্য</span>
                      </div>

                      <div>
                        <label className="block text-[13px] font-semibold text-gray-800 mb-1">
                          বিক্রয়মূল্য (Sale Price ৳) *
                        </label>
                        <input
                          type="number"
                          required
                          min="1"
                          step="any"
                          placeholder="যেমন: ৯৫০০০"
                          value={salePrice}
                          onChange={(e) => setSalePrice(e.target.value)}
                          className="w-full bg-white border border-amber-300 rounded-lg p-2.5 text-[15px] font-bold text-gray-900 font-mono focus:ring-2 focus:ring-amber-500"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[13px] font-medium text-gray-700 mb-1">
                            ক্রেতার নাম (Customer Name)
                          </label>
                          <input
                            type="text"
                            placeholder="সাধারণ ক্রেতা"
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            className="w-full bg-white border border-gray-300 rounded-lg p-2 text-[13px] text-gray-900"
                          />
                        </div>

                        <div>
                          <label className="block text-[13px] font-medium text-gray-700 mb-1">
                            টাকা জমার হিসাব (Deposit To)
                          </label>
                          <select
                            value={statusPaymentMethod}
                            onChange={(e) => setStatusPaymentMethod(e.target.value as any)}
                            className="w-full bg-white border border-gray-300 rounded-lg p-2 text-[13px] text-gray-900"
                          >
                            <option value="CASH">নগদ ক্যাশ (1010)</option>
                            <option value="BANK">ব্যাংক হিসাব (1030)</option>
                          </select>
                        </div>
                      </div>

                      <p className="text-[12px] text-amber-800 leading-relaxed">
                        বিক্রয় সংরক্ষিত হলে স্বয়ংক্রিয়ভাবে পশু বিক্রয় আয় (৪০২০) ক্রেডিট এবং ক্যাশ/ব্যাংক ডেবিট করে জাবেদা ভাউচার ও বিক্রয় চালান তৈরি হবে।
                      </p>
                    </div>
                  )}

                  {newStatus !== 'SOLD' && (
                    <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-[13px] text-gray-600">
                      পশুটি সক্রিয় তালিকা থেকে অপসারিত হয়ে "নিষ্ক্রিয়/বিক্রিত" ট্যাবে সংরক্ষিত থাকবে।
                    </div>
                  )}

                  {/* Notes */}
                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                      মন্তব্য বা বিবরণ (Notes)
                    </label>
                    <textarea
                      rows={2}
                      value={statusNotes}
                      onChange={(e) => setStatusNotes(e.target.value)}
                      placeholder="অপসারণ বা বিক্রয়ের কারণ বা মন্তব্য লিখুন..."
                      className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 focus:ring-2 focus:ring-amber-500"
                    />
                  </div>

                  <div className="flex justify-end gap-2.5 pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      disabled={submittingStatus}
                      onClick={() => setStatusModalAnimal(null)}
                      className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                    >
                      বাতিল
                    </button>
                    <button
                      type="submit"
                      disabled={submittingStatus}
                      className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-bold cursor-pointer shadow-xs min-h-[40px]"
                    >
                      {submittingStatus ? 'সংরক্ষণ হচ্ছে...' : 'স্ট্যাটাস নিশ্চিত করুন'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ================= MODAL 3: ACTIVITY HISTORY ================= */}
          {historyModalAnimal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
              <div className="bg-white rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl border border-gray-200 my-8 space-y-4">
                <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                  <div>
                    <h4 className="text-[17px] font-bold text-gray-900 flex items-center gap-2">
                      <History className="w-5 h-5 text-[#1E5128]" />
                      <span>কার্যক্রমের ইতিহাস: {historyModalAnimal.id}</span>
                    </h4>
                    <p className="text-[13px] text-gray-600 mt-0.5">
                      জাত: {historyModalAnimal.breed} | সর্বমোট খরচ: {fmt(historyModalAnimal.totalCost)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHistoryModalAnimal(null)}
                    className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="max-h-[60vh] overflow-y-auto space-y-2.5 pr-1">
                  {(() => {
                    const evs = animalEvents
                      .filter((e) => e.animalId === historyModalAnimal.id)
                      .sort((a, b) => (b.date > a.date ? 1 : -1));

                    if (evs.length === 0) {
                      return (
                        <p className="text-[14px] text-gray-500 text-center py-6">
                          এই পশুর কোনো কার্যক্রম রেকর্ড করা নেই।
                        </p>
                      );
                    }

                    return evs.map((ev) => (
                      <div
                        key={ev.id}
                        className="p-3 rounded-xl bg-gray-50 border border-gray-200 space-y-1.5 text-[13px]"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                ev.eventType === 'FEED'
                                  ? 'bg-amber-100 text-amber-800'
                                  : ev.eventType === 'VACCINE'
                                  ? 'bg-blue-100 text-blue-800'
                                  : ev.eventType === 'TREATMENT'
                                  ? 'bg-purple-100 text-purple-800'
                                  : ev.eventType === 'WEIGHT'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : ev.eventType === 'MILK'
                                  ? 'bg-cyan-100 text-cyan-800'
                                  : 'bg-gray-200 text-gray-800'
                              }`}
                            >
                              {ev.eventType}
                            </span>
                            <span className="text-gray-500 font-mono text-[12px]">{ev.date}</span>
                          </div>
                          {ev.cost > 0 && (
                            <span className="font-bold text-rose-700 font-mono">{fmt(ev.cost)}</span>
                          )}
                        </div>

                        {ev.details && <p className="text-gray-800">{ev.details}</p>}

                        {ev.vaccineName && (
                          <div className="text-[12px] text-blue-700 font-medium">
                            টিকা/ওষুধ: {ev.vaccineName}
                            {ev.nextDueDate && ` | পরবর্তী ডোজ: ${ev.nextDueDate}`}
                          </div>
                        )}

                        {ev.milkLiters !== undefined && ev.milkLiters > 0 && (
                          <div className="text-[12px] text-cyan-800 font-medium">
                            দুধের পরিমাণ: {ev.milkLiters} লিটার
                          </div>
                        )}

                        {ev.weightKg !== undefined && ev.weightKg > 0 && (
                          <div className="text-[12px] text-emerald-800 font-medium">
                            পরিমাপকৃত ওজন: {ev.weightKg} কেজি
                          </div>
                        )}
                      </div>
                    ));
                  })()}
                </div>

                <div className="flex justify-end pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setHistoryModalAnimal(null)}
                    className="px-4 py-2 rounded-xl bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer"
                  >
                    বন্ধ করুন
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ===================== TAB 2: FISHERIES ===================== */}
      {tab === 'fisheries' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Fish className="w-5 h-5 text-sky-600" />
                <span>মৎস্য চাষ ও পুকুর ব্যাচ ({fishBatches.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">পোনা মজুদের হিসাব, ফিড খরচ ও মরটালিটি ট্র্যাকিং</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddFish(!showAddFish)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন মাছের ব্যাচ</span>
              </button>
            )}
          </div>

          {showAddFish && (
            <form onSubmit={handleAddFish} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন মাছের ব্যাচ মজুদ</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  required
                  placeholder="পুকুরের নাম (যেমন: পশ্চিম পুকুর)"
                  value={pondName}
                  onChange={(e) => setPondName(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="text"
                  required
                  placeholder="মাছের প্রজাতি (যেমন: কার্প ও পাবদা)"
                  value={fishSpecies}
                  onChange={(e) => setFishSpecies(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="number"
                  placeholder="পোনা সংখ্যা (Qty)"
                  value={fingerlingQty}
                  onChange={(e) => setFingerlingQty(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="number"
                  placeholder="পোনা ক্রয়ের মোট খরচ ৳"
                  value={fingerlingCost}
                  onChange={(e) => setFingerlingCost(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddFish(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  ব্যাচ তৈরি করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {fishBatches.map((b) => (
              <div
                key={b.id}
                className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2.5 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono font-bold text-sky-700 text-[14px]">{b.id}</span>
                    <h4 className="font-bold text-gray-900 text-[15px]">{b.pondName}</h4>
                    <p className="text-[13px] text-gray-600">{b.species}</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-xs font-semibold">
                    {b.status}
                  </span>
                </div>

                <div className="space-y-1.5 text-[13px] pt-2 border-t border-gray-200">
                  <div className="flex justify-between">
                    <span className="text-gray-600">মজুদ পোনা:</span>
                    <span className="font-semibold text-gray-900">{b.fingerlingQty} টি</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">পোনা খরচ:</span>
                    <span className="font-semibold text-gray-900">{fmt(b.fingerlingCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">মোট ফিড প্রয়োগ:</span>
                    <span className="font-semibold text-amber-700">{b.totalFeedKg} কেজি ({fmt(b.totalFeedCost)})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">মৃত পোনা সংখ্যা:</span>
                    <span className="font-semibold text-red-600">{b.mortalityCount} টি</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== TAB 3: CROPS & FODDER ===================== */}
      {tab === 'crops' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <Wheat className="w-5 h-5 text-amber-600" />
                <span>শস্য ও নেপিয়ার ঘাস চাষ ({cropCycles.length})</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">ঘাস চাষ, সার প্রয়োগ, সেচ ও ফসল কর্তন ট্র্যাকিং</p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddCrop(!showAddCrop)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন শস্য চক্র</span>
              </button>
            )}
          </div>

          {showAddCrop && (
            <form onSubmit={handleAddCrop} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন শস্য চক্র যুক্ত করুন</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  required
                  placeholder="জমির প্লট (যেমন: প্লট-২ উত্তর)"
                  value={plotName}
                  onChange={(e) => setPlotName(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="text"
                  required
                  placeholder="ফসলের নাম (যেমন: পাকচং নেপিয়ার)"
                  value={cropName}
                  onChange={(e) => setCropName(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="number"
                  placeholder="জমির পরিমাণ (শতাংশ)"
                  value={cropArea}
                  onChange={(e) => setCropArea(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddCrop(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  সংরক্ষণ করুন
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {cropCycles.map((c) => (
              <div
                key={c.id}
                className="p-4 rounded-xl bg-[#F8FAFC] border border-gray-200 space-y-2.5 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono font-bold text-amber-700 text-[14px]">{c.id}</span>
                    <h4 className="font-bold text-gray-900 text-[15px]">{c.cropName}</h4>
                    <p className="text-[13px] text-gray-600">{c.plotName} ({c.areaDecimals} শতাংশ)</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
                    {c.status}
                  </span>
                </div>

                <div className="space-y-1.5 text-[13px] pt-2 border-t border-gray-200">
                  <div className="flex justify-between">
                    <span className="text-gray-600">রোপণের তারিখ:</span>
                    <span className="font-medium text-gray-900">{c.plantingDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">মোট চাষ খরচ:</span>
                    <span className="font-semibold text-red-600">{fmt(c.totalCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">কর্তনকৃত ফলন:</span>
                    <span className="text-[#15803D] font-bold">{c.harvestYieldKg} কেজি</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===================== TAB 4: INTERNAL FLOWS ===================== */}
      {tab === 'flows' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
            <div>
              <h3 className="text-[16px] font-bold text-gray-900 flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-[#1E5128]" />
                <span>অভ্যন্তরীণ সমন্বিত সম্পদ স্থানান্তর (Circular Bio-Flows)</span>
              </h3>
              <p className="text-[13px] text-gray-600 mt-0.5">
                গোবর পুকুর বা ফসলে প্রয়োগ, কিংবা উৎপাদিত নেপিয়ার ঘাস গরুকে খাওয়ানো (ডাবল-কাউন্টিং মুক্ত)
              </p>
            </div>

            {role === 'OWNER' && (
              <button
                onClick={() => setShowAddFlow(!showAddFlow)}
                className="px-3.5 py-2 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition-all cursor-pointer min-h-[40px] flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ নতুন স্থানান্তর</span>
              </button>
            )}
          </div>

          {showAddFlow && (
            <form onSubmit={handleAddInternalFlow} className="p-4 bg-[#F8FAFC] border border-gray-300 rounded-xl space-y-3">
              <div className="font-bold text-[#1E5128] text-[15px]">নতুন বায়ো-ফ্লো রেকর্ড</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <select
                  value={flowResource}
                  onChange={(e) => setFlowResource(e.target.value as any)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                >
                  <option value="MANURE">গোবর সার (Manure)</option>
                  <option value="COMPOST">কম্পোস্ট সার (Compost)</option>
                  <option value="FODDER_GRASS">নেপিয়ার ঘাস (Fodder Grass)</option>
                  <option value="CROP_RESIDUE">ফসলের উচ্ছিষ্টাংশ (Crop Residue)</option>
                  <option value="OTHER">অন্যান্য জৈব উপাদান</option>
                </select>
                <input
                  type="text"
                  placeholder="উৎস (যেমন: ডেইরি শেড)"
                  value={flowSource}
                  onChange={(e) => setFlowSource(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="text"
                  placeholder="গন্তব্য (যেমন: মাছের পুকুর)"
                  value={flowDestination}
                  onChange={(e) => setFlowDestination(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  placeholder="বিবরণ"
                  value={flowDesc}
                  onChange={(e) => setFlowDesc(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="number"
                  placeholder="পরিমাণ (কেজি)"
                  value={flowQty}
                  onChange={(e) => setFlowQty(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
                <input
                  type="number"
                  placeholder="আনুমানিক আর্থিক মূল্য ৳"
                  value={flowValue}
                  onChange={(e) => setFlowValue(e.target.value)}
                  className="bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddFlow(false)}
                  className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-[13px] font-semibold cursor-pointer min-h-[40px]"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#1E5128] text-white text-[13px] font-bold cursor-pointer min-h-[40px]"
                >
                  রেকর্ড করুন
                </button>
              </div>
            </form>
          )}

          <div className="space-y-2.5">
            {internalFlows.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-[14px]">
                কোনো অভ্যন্তরীণ প্রবাহ রেকর্ড করা নেই।
              </div>
            ) : (
              internalFlows.map((fl) => (
                <div
                  key={fl.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl bg-[#F8FAFC] border border-gray-200 text-[14px] gap-2"
                >
                  <div>
                    <div className="font-bold text-gray-900">{fl.notes || fl.resource}</div>
                    <div className="text-[13px] text-gray-600">
                      {fl.source} ➔ {fl.destination} | তারিখ: {fl.date} | পরিমাণ: {fl.quantity} {fl.unit}
                    </div>
                  </div>
                  <div className="font-bold text-[#15803D] font-mono text-[15px]">
                    মূল্য: {fmt(fl.internalCostValuation)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL: ADD STANDALONE REMINDER ================= */}
      {showAddReminderModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-gray-200 my-8 space-y-4">
            <div className="flex items-start justify-between border-b border-gray-100 pb-3">
              <div>
                <h4 className="text-[17px] font-bold text-gray-900 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-[#1E5128]" />
                  <span>নতুন রিমাইন্ডার / করণীয় কাজ</span>
                </h4>
                <p className="text-[13px] text-gray-600 mt-0.5">
                  পশু বা সাধারণ খামার বিষয়ক সময়মতো করণীয় তালিকা
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddReminderModal(false)}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStandaloneReminder} className="space-y-3.5">
              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                  কাজের শিরোনাম (Title) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="যেমন: হাটে গরু বিক্রয় সফর / ঘাস কাটার প্রস্তুতি"
                  value={reminderTitle}
                  onChange={(e) => setReminderTitle(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 focus:ring-2 focus:ring-[#1E5128]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                    ক্যাটাগরি (Category) *
                  </label>
                  <select
                    value={reminderCategory}
                    onChange={(e) => setReminderCategory(e.target.value as any)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 font-medium focus:ring-2 focus:ring-[#1E5128]"
                  >
                    <option value="MARKET">বাজার / হাট (MARKET)</option>
                    <option value="VACCINE">টিকা (VACCINE)</option>
                    <option value="TREATMENT">চিকিৎসা (TREATMENT)</option>
                    <option value="OTHER">অন্যান্য (OTHER)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                    করণের তারিখ (Due Date) *
                  </label>
                  <input
                    type="date"
                    required
                    value={reminderDueDate}
                    onChange={(e) => setReminderDueDate(e.target.value)}
                    className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 focus:ring-2 focus:ring-[#1E5128]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1">
                  নির্দিষ্ট পশু (Optional Animal)
                </label>
                <select
                  value={reminderAnimalId}
                  onChange={(e) => setReminderAnimalId(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg p-2.5 text-[14px] text-gray-900 focus:ring-2 focus:ring-[#1E5128]"
                >
                  <option value="">কোনো নির্দিষ্ট পশু নয় (Standalone)</option>
                  {animals.map((an) => (
                    <option key={an.id} value={an.id}>
                      {an.tag || an.id} - {an.breed} ({an.species})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddReminderModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 text-[13px] font-semibold transition cursor-pointer"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#1E5128] hover:bg-[#173F1F] text-white text-[13px] font-bold shadow-xs transition cursor-pointer"
                >
                  রিমাইন্ডার সংরক্ষণ করুন
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Duplicate Animal Tag Confirmation Modal */}
      {duplicateTagWarning && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-xl border border-gray-200 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2.5 text-amber-700">
                <AlertTriangle className="w-6 h-6 shrink-0" />
                <h3 className="text-lg font-bold text-gray-900">ট্যাগ সতর্কতা (Duplicate Tag Warning)</h3>
              </div>
              <button
                type="button"
                onClick={() => setDuplicateTagWarning(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-gray-900 text-[15px] font-semibold leading-relaxed">
                এই ট্যাগটি ইতিমধ্যে ব্যবহৃত হয়েছে — এটি কি ডুপ্লিকেট এন্ট্রি?
              </p>
              <p className="text-gray-600 text-[13px]">
                ট্যাগ নং: <span className="font-mono font-bold text-gray-900">{duplicateTagWarning.tag}</span>
              </p>
              <p className="text-amber-800 text-[12px] bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                সতর্কতা: একই ট্যাগ ব্যবহার করলে পশুর সঠিক শনাক্তকরণ ও ট্র্যাকিংয়ে বিভ্রান্তি সৃষ্টি হতে পারে। আপনি চাইলে ফিরে গিয়ে ভিন্ন ট্যাগ দিতে পারেন অথবা এই ট্যাগেই নিবন্ধন সম্পন্ন করতে পারেন।
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                id="btn-edit-duplicate-tag"
                onClick={() => setDuplicateTagWarning(null)}
                className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors cursor-pointer min-h-[40px]"
              >
                ফিরে যান ও সম্পাদনা করুন
              </button>
              <button
                type="button"
                id="btn-proceed-duplicate-tag"
                onClick={() => executeSaveAnimal(duplicateTagWarning.animalData)}
                className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all cursor-pointer shadow-xs min-h-[40px]"
              >
                তবুও এগিয়ে যান
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
